/**
 * Context Builder
 *
 * Combines all context sources into a single system prompt block:
 * - File tree (visual representation)
 * - Hot files (recently modified/active)
 * - Selected relevant files (dynamic)
 * - Attachments
 * - Memory (cross-session)
 *
 * This replaces the monolithic context building logic in route.ts.
 */

import type { MemoryEntry } from "./memory";
import { selectRelevantFiles } from "./dynamic-context";

/**
 * Attachment item shape — mirrors the type defined in the chat route.
 */
export type AttachmentItem = {
  name: string;
  content: string;
  mimeType: string;
};

type BuildContextOptions = {
  fileTree: Array<{ path: string; code: string }>;
  hotFiles: string[];
  attachments: AttachmentItem[];
  memories: MemoryEntry[];
  intent: string;
  maxFileContentBytes: number;
};

/**
 * Build a concise file tree for the system prompt.
 */
export function buildFileTree(fileTree: Array<{ path: string; code: string }>): string {
  const paths = fileTree.map((f) => f.path);
  const lines = paths.map((p) => `  ${p}`).sort();
  return `当前项目文件树:\n${lines.join("\n")}`;
}

/**
 * Build the full context block for Alex's prompt.
 */
export function buildFullContext(options: BuildContextOptions): string {
  const { fileTree, hotFiles, attachments, memories, intent, maxFileContentBytes } = options;

  const sections: string[] = [];

  // 1. File tree (always included, lightweight)
  sections.push(buildFileTree(fileTree));

  // 2. Hot files list
  if (hotFiles.length > 0) {
    sections.push(`当前活跃/热文件: ${hotFiles.join(", ")}`);
  }

  // 3. Memory block
  if (memories.length > 0) {
    const CATEGORY_LABELS: Record<string, string> = {
      preference: "偏好",
      convention: "惯例",
      lesson: "教训",
      context: "上下文",
    };
    const memoryLines = memories.map(
      (m) => `- [${CATEGORY_LABELS[m.category] ?? m.category}] ${m.content}`,
    );
    sections.push(`[项目记忆]\n${memoryLines.join("\n")}\n[/项目记忆]`);
  }

  // 4. Selected file contents (top files by relevance)
  const relevantFiles = selectRelevantFiles(fileTree, intent, hotFiles);
  if (relevantFiles.length > 0) {
    const fileContents = relevantFiles
      .map((f) => {
        const safeCode =
          f.code.length > maxFileContentBytes
            ? f.code.slice(0, maxFileContentBytes) + "\n\n...[文件过长，已截断]"
            : f.code;
        return `--- ${f.path} ---\n${safeCode}`;
      })
      .join("\n\n");
    sections.push(`[相关文件内容]\n${fileContents}\n[/相关文件内容]`);
  }

  // 5. Attachments
  if (attachments.length > 0) {
    const attachmentText = attachments
      .map((a) => `[附件: ${a.name}] (${a.mimeType?.startsWith("image") ? "图片" : "文件"})`)
      .join("\n");
    sections.push(attachmentText);
  }

  return sections.join("\n\n");
}

/**
 * Tool Result Formatter
 *
 * Truncates verbose tool outputs to prevent context bloat while preserving
 * the most useful signal (beginning + end of outputs).
 * Inspired by Claude Code's tool result budget management.
 */

import type { WebContainerToolName, WebContainerBridgeResult } from "./webcontainer-bridge";

type ToolCallInput = {
  path?: string;
  procId?: string;
  command?: string;
  content?: string;
};

const READ_FILE_TRUNCATE_THRESHOLD = 4000;
const READ_FILE_HEAD = 2000;
const READ_FILE_TAIL = 1000;

const READDIR_MAX_ENTRIES = 50;
const READDIR_SHOW_ENTRIES = 40;

const PROCESS_OUTPUT_TRUNCATE_THRESHOLD = 6000;
const PROCESS_OUTPUT_HEAD = 3000;
const PROCESS_OUTPUT_TAIL = 3000;

/** Directories that should always be excluded from readdir output. */
const READDIR_IGNORE_DIRS = [
  "node_modules",
  ".next",
  "dist",
  ".turbo",
  "__pycache__",
  ".git",
  ".DS_Store",
];

/**
 * Check if a readdir entry should be ignored (dependency/cache directory).
 */
function shouldIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();
  return READDIR_IGNORE_DIRS.some((dir) => trimmed === dir || trimmed.startsWith(`${dir}/`));
}

/**
 * Truncate a string to head + tail with an omission marker in between.
 */
function headTail(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  const omitted = text.length - head - tail;
  return text.slice(0, head) + `\n\n...[省略 ${omitted} 个字符]...\n\n` + text.slice(-tail);
}

/**
 * Format a readdir result to avoid flooding context with dependency directories.
 * Strategy:
 * 1. Filter out node_modules, .next, dist, .turbo, etc. first
 * 2. If still >50 entries, truncate alphabetically and hint to explore subdirectories
 * 3. Report how many entries were auto-filtered
 */
function formatReaddir(detail: string): {
  detail: string;
  truncated: boolean;
} {
  if (!detail) return { detail: detail ?? "", truncated: false };

  const allLines = detail.split("\n").filter((line) => line.trim().length > 0);
  const ignoredCount = allLines.filter(shouldIgnoreEntry).length;
  const filteredLines = allLines.filter((line) => !shouldIgnoreEntry(line));
  const entryCount = filteredLines.length;

  if (entryCount > READDIR_MAX_ENTRIES) {
    const shown = filteredLines.slice(0, READDIR_SHOW_ENTRIES).join("\n");
    let extraNote = `...（还有 ${entryCount - READDIR_SHOW_ENTRIES} 个条目，请使用 wc.fs.readdir 指定子目录进一步探索）`;
    if (ignoredCount > 0) {
      extraNote = `（已自动过滤 ${ignoredCount} 个依赖/缓存目录）\n${extraNote}`;
    }
    return {
      detail: `${shown}\n\n${extraNote}`,
      truncated: true,
    };
  }

  if (ignoredCount > 0) {
    return {
      detail: `${filteredLines.join("\n")}\n\n（已自动过滤 ${ignoredCount} 个依赖/缓存目录）`,
      truncated: false,
    };
  }

  return { detail, truncated: false };
}

/**
 * Format a readFile result to truncate very large files.
 */
function formatReadFileContent(content: string | undefined): string | undefined {
  if (content === undefined) return undefined;
  if (content.length <= READ_FILE_TRUNCATE_THRESHOLD) return content;
  return headTail(content, READ_FILE_HEAD, READ_FILE_TAIL);
}

/**
 * Format a process output (stdout/stderr) to avoid flooding with npm logs.
 */
function formatProcessOutput(output: string | undefined): string | undefined {
  if (output === undefined) return undefined;
  if (output.length <= PROCESS_OUTPUT_TRUNCATE_THRESHOLD) return output;
  return headTail(output, PROCESS_OUTPUT_HEAD, PROCESS_OUTPUT_TAIL);
}

/**
 * Format a bridge tool result for injection into the tool loop messages.
 * Returns the formatted detail string and whether any truncation was applied.
 */
export function formatBridgeToolResultForLoop(
  tool: WebContainerToolName,
  result: WebContainerBridgeResult,
  input: ToolCallInput
): { formatted: Record<string, unknown>; truncated: boolean } {
  let truncated = false;

  if (!result.ok) {
    // Errors are always returned in full — the agent needs to see the complete error.
    return {
      formatted: {
        ok: false,
        tool,
        path: input.path,
        procId: input.procId,
        error: result.error,
        detail: result.detail,
      },
      truncated: false,
    };
  }

  let detail = result.detail ?? "";

  if (tool === "wc.fs.readdir") {
    const readdirResult = formatReaddir(detail);
    detail = readdirResult.detail;
    truncated = readdirResult.truncated;
  }

  // For readFile, truncate the content in the data payload
  if (tool === "wc.fs.readFile" && result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    const originalContent = data.content as string | undefined;
    if (typeof originalContent === "string") {
      const truncatedContent = formatReadFileContent(originalContent) ?? originalContent;
      data.content = truncatedContent;
      if (truncatedContent.length < originalContent.length) {
        truncated = true;
      }
    }
  }

  // For spawn, truncate the process output
  if (tool === "wc.spawn" && result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    const originalOutput = data.output as string | undefined;
    if (typeof originalOutput === "string") {
      const truncatedOutput = formatProcessOutput(originalOutput) ?? originalOutput;
      data.output = truncatedOutput;
      if (truncatedOutput.length < originalOutput.length) {
        truncated = true;
      }
    }
  }

  // For readProcess, truncate the output
  if (tool === "wc.readProcess" && result.data && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    if (typeof data.output === "string" || typeof data.stdout === "string") {
      const originalOutput = data.output as string | undefined;
      if (typeof originalOutput === "string") {
        const truncatedOutput = formatProcessOutput(originalOutput) ?? originalOutput;
        data.output = truncatedOutput;
        if (truncatedOutput.length < originalOutput.length) {
          truncated = true;
        }
      }
      const originalStdout = data.stdout as string | undefined;
      if (typeof originalStdout === "string") {
        const truncatedStdout = formatProcessOutput(originalStdout) ?? originalStdout;
        data.stdout = truncatedStdout;
        if (truncatedStdout.length < originalStdout.length) {
          truncated = true;
        }
      }
    }
  }

  return {
    formatted: {
      ok: true,
      tool,
      path: input.path,
      procId: input.procId,
      detail,
      data: result.data,
    },
    truncated,
  };
}

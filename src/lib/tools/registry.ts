/**
 * Tool Registry — Zod-based tool definitions for the Alex agent.
 *
 * Unifies four previously scattered concerns:
 * 1. TypeScript input types (derived from Zod schemas)
 * 2. Runtime validation (Zod .parse() replaces manual typeof checks)
 * 3. Prompt examples (auto-generated from schema + description)
 * 4. Bridge input mapping (defaults defined alongside schema)
 */

import { z } from "zod";
import type { WebContainerToolName, WebContainerToolInputMap } from "../webcontainer-bridge";

/**
 * Tool category for determining execution strategy.
 * - "read": safe to run in parallel with other reads
 * - "write": must run exclusively (mutates state)
 */
type ToolCategory = "read" | "write";

export type ToolDefinition<
  TName extends WebContainerToolName = WebContainerToolName,
  TInput extends Record<string, unknown> = Record<string, unknown>,
> = {
  name: TName;
  category: ToolCategory;
  description: string;
  example: TInput;
  schema: z.ZodType<TInput>;
  /** Transform validated input into the bridge request input format */
  toBridgeInput: (input: TInput) => WebContainerToolInputMap[TName];
};

// ─── Individual Tool Schemas ───────────────────────────────────────────────

const readFileSchema = z.object({
  path: z.string().min(1, "path 不能为空"),
  encoding: z.literal("utf-8").optional(),
});

const writeFileSchema = z.object({
  path: z.string().min(1, "path 不能为空"),
  content: z.string({ message: "content 必须为字符串" }),
});

const readdirSchema = z.object({
  path: z.string().min(1, "path 不能为空"),
});

const mkdirSchema = z.object({
  path: z.string().min(1, "path 不能为空"),
});

const rmSchema = z.object({
  path: z.string().min(1, "path 不能为空"),
  recursive: z.boolean().optional(),
});

const spawnSchema = z.object({
  command: z.string().min(1, "command 不能为空"),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  waitForExit: z.boolean().optional(),
});

const readProcessSchema = z.object({
  procId: z.string().min(1, "procId 不能为空"),
});

const killProcessSchema = z.object({
  procId: z.string().min(1, "procId 不能为空"),
});

// ─── Tool Definitions ──────────────────────────────────────────────────────

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "wc.fs.readFile",
    category: "read",
    description: "读取文件内容",
    example: { path: "/src/App.tsx", encoding: "utf-8" },
    schema: readFileSchema,
    toBridgeInput: (input) => ({ path: input.path, encoding: input.encoding ?? "utf-8" }),
  },
  {
    name: "wc.fs.writeFile",
    category: "write",
    description: "写入文件内容",
    example: { path: "/src/App.tsx", content: "export default function App() { return null }" },
    schema: writeFileSchema,
    toBridgeInput: (input) => ({ path: input.path, content: input.content }),
  },
  {
    name: "wc.fs.readdir",
    category: "read",
    description: "列出目录内容",
    example: { path: "/src/components" },
    schema: readdirSchema,
    toBridgeInput: (input) => ({ path: input.path }),
  },
  {
    name: "wc.fs.mkdir",
    category: "write",
    description: "创建目录（含父目录）",
    example: { path: "/src/components/ui" },
    schema: mkdirSchema,
    toBridgeInput: (input) => ({ path: input.path }),
  },
  {
    name: "wc.fs.rm",
    category: "write",
    description: "删除文件或目录",
    example: { path: "/src/legacy", recursive: true },
    schema: rmSchema,
    toBridgeInput: (input) => ({ path: input.path, recursive: input.recursive === true }),
  },
  {
    name: "wc.spawn",
    category: "write",
    description: "执行终端命令",
    example: { command: "npm", args: ["run", "build"], waitForExit: true },
    schema: spawnSchema,
    toBridgeInput: (input) => ({
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd,
      waitForExit: input.waitForExit === true,
    }),
  },
  {
    name: "wc.readProcess",
    category: "read",
    description: "读取运行中进程的输出",
    example: { procId: "proc:1" },
    schema: readProcessSchema,
    toBridgeInput: (input) => ({ procId: input.procId }),
  },
  {
    name: "wc.killProcess",
    category: "write",
    description: "终止运行中的进程",
    example: { procId: "proc:1" },
    schema: killProcessSchema,
    toBridgeInput: (input) => ({ procId: input.procId }),
  },
];

// ─── Lookup Maps ───────────────────────────────────────────────────────────

const toolMap = new Map<string, ToolDefinition>(
  toolDefinitions.map((def) => [def.name, def])
);

export function getTool(name: WebContainerToolName): ToolDefinition {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`未知工具: ${name}`);
  return tool;
}

export const readTools = toolDefinitions
  .filter((d) => d.category === "read")
  .map((d) => d.name);

export const writeTools = toolDefinitions
  .filter((d) => d.category === "write")
  .map((d) => d.name);

export function isReadTool(name: WebContainerToolName): boolean {
  return readTools.includes(name as (typeof readTools)[number]);
}

export const allToolNames = toolDefinitions.map((d) => d.name);

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validate a raw tool input object against the tool's Zod schema.
 * Returns the normalized input on success, throws on failure.
 */
export function validateToolInput(
  name: WebContainerToolName,
  raw: unknown
): Record<string, unknown> {
  const tool = getTool(name);
  const result = tool.schema.safeParse(raw);
  if (!result.success) {
    const firstError = result.error.errors[0]?.message ?? "参数校验失败";
    throw new Error(`${name}: ${firstError}`);
  }
  return result.data as Record<string, unknown>;
}

// ─── Prompt Generation ─────────────────────────────────────────────────────

/**
 * Auto-generate the tool list section for the agent prompt.
 * Replaces the hardcoded tool descriptions in agent-prompts.ts.
 */
export function generateToolPromptSection(): string {
  const lines = toolDefinitions.map((def, i) => {
    const exampleJson = JSON.stringify(def.example);
    return `${i + 1}) ${def.name}: ${exampleJson}  — ${def.description}`;
  });

  return [
    "你可以调用以下真实的 WebContainer 工具：",
    ...lines,
  ].join("\n");
}

/**
 * Generate a compact tool reference for the tool loop prompt
 * (shorter version, just names and examples).
 */
export function generateToolQuickReference(): string {
  return toolDefinitions
    .map((def) => `  ${def.name}: ${JSON.stringify(def.example)}`)
    .join("\n");
}

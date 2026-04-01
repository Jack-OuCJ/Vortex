import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Allow, parse as parsePartialJson } from "partial-json";
import { createClient } from "@/lib/supabase/server";
import {
  ENGINEER_CHAT_REPLY_PROMPT,
  type EngineerExecutionMode,
  buildEngineerRoutePrompt,
  buildEngineerToolLoopPrompt,
} from "@/lib/agent-prompts";
import {
  createWebContainerBridgeRequest,
  type WebContainerBridgeRequest,
  type WebContainerBridgeResult,
  type WebContainerToolInputMap,
  type WebContainerToolName,
} from "@/lib/webcontainer-bridge";

export const runtime = "nodejs";

type ProjectFile = {
  path: string;
  code: string;
};

type AgentEvent = {
  eventType?: "agent";
  agent: "engineer";
  name: string;
  status: "thinking" | "done" | "error" | "streaming";
  content?: string;
  projectFiles?: ProjectFile[];
  fileTimestamps?: Array<{ path: string; updated_at: string }>;
  isAppDemand?: boolean;
};

type SessionEvent = {
  eventType: "session";
  sessionId: string;
};

type StepEvent = {
  eventType: "step";
  stepId: "route" | "execute";
  title: string;
  status: "running" | "done" | "error";
  detail?: string;
};

type ToolEvent = {
  eventType: "tool";
  callId: string;
  action: "tool_start" | "tool_input_delta" | "tool_result" | "tool_error";
  toolName:
    | "route_request"
    | "execute_task"
    | "wc.fs.readFile"
    | "wc.fs.writeFile"
    | "wc.fs.readdir"
    | "wc.fs.mkdir"
    | "wc.fs.rm"
    | "wc.spawn"
    | "wc.readProcess"
    | "wc.killProcess";
  detail?: string;
};

type WebContainerRequestEvent = {
  eventType: "webcontainer_request";
  request: WebContainerBridgeRequest;
};

type ProjectRenameEvent = {
  eventType: "project_rename";
  projectName: string;
};

type StreamEvent = AgentEvent | SessionEvent | StepEvent | ToolEvent | ProjectRenameEvent | WebContainerRequestEvent;

type RequestProjectFile = {
  path: string;
  code: string;
};

type RequestFileTreeItem = {
  path: string;
  size?: number;
  isActive?: boolean;
  isDirty?: boolean;
  isRecentlyEdited?: boolean;
};

type RequestBody = {
  message?: string;
  errorMessage?: string;
  projectFiles?: RequestProjectFile[];
  hotFiles?: RequestProjectFile[];
  fileTree?: RequestFileTreeItem[];
  projectId?: string;
  sessionId?: string;
  isNewProject?: boolean;
};

type EngineerRouteDecision = {
  mode: EngineerExecutionMode;
  intentSummary: string;
  reply: string;
  executionBrief: string;
  projectName: string;
  shouldWriteTodo: boolean;
};

type PersistedChatMessage = {
  role: "user" | "agent";
  agent_name: string | null;
  agent_role: string | null;
  content: string;
  status: "thinking" | "streaming" | "done" | "stopped" | "error";
  created_at: string;
};

type ToolLoopDecision =
  | {
      action: "tool_call";
      tool: WebContainerToolName;
      input: {
        path?: string;
        encoding?: "utf-8";
        content?: string;
        recursive?: boolean;
        command?: string;
        args?: string[];
        cwd?: string;
        waitForExit?: boolean;
        procId?: string;
      };
      reason?: string;
    }
  | {
      action: "final";
      files: ProjectFile[];
      deletedPaths?: string[];
      summary?: string;
    };

type FileToolLoopResult = {
  projectFiles: ProjectFile[];
  summary?: string;
};

type ToolCallInput = Extract<ToolLoopDecision, { action: "tool_call" }>[
  "input"
];

const parseJSONFromLLM = (content: string) => {
  try {
    const text = content.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      return parsePartialJson(text, Allow.ALL) as unknown;
    }

    const startObj = text.indexOf("{");
    const endObj = text.lastIndexOf("}");
    const startArr = text.indexOf("[");
    const endArr = text.lastIndexOf("]");
    
    // Determine whether it's trying to return an object or an array
    if (startArr !== -1 && endArr !== -1 && (startObj === -1 || startArr < startObj)) {
      return parsePartialJson(text.substring(startArr, endArr + 1), Allow.ALL) as unknown;
    }
    if (startObj !== -1 && endObj !== -1) {
      return parsePartialJson(text.substring(startObj, endObj + 1), Allow.ALL) as unknown;
    }
    throw new Error("No JSON structure found");
  } catch {
    throw new Error("Failed to parse JSON from LLM: \n" + content);
  }
};

const cleanThinkTags = (text: string) => {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const unclosedIdx = cleaned.lastIndexOf("<think>");
  if (unclosedIdx !== -1) {
    cleaned = cleaned.substring(0, unclosedIdx);
  }
  return cleaned.trim();
};

const createModel = () => {
  return new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.2,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
  });
};

const isLikelyMiniMax = () => {
  const baseURL = (process.env.OPENAI_BASE_URL ?? "").toLowerCase();
  const modelName = (process.env.OPENAI_MODEL ?? "").toLowerCase();
  return baseURL.includes("minimax") || modelName.includes("minimax");
};

const messageContentToText = (content: unknown) => {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content ?? "");
  }
};

const normalizeMessagesForProvider = (messages: Array<HumanMessage | SystemMessage>) => {
  if (!isLikelyMiniMax()) return messages;

  return messages.map((msg) => {
    if (msg instanceof SystemMessage) {
      // MiniMax OpenAI-compatible endpoint may reject role=system.
      return new HumanMessage(`[系统指令]\n${messageContentToText(msg.content)}`);
    }
    return msg;
  });
};

const sendEvent = (
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: StreamEvent
) => {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
  );
};

type PersistContext = {
  enabled: boolean;
  sessionId: string | null;
  userMessage: string | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const upsertAgentMessage = async (
  ctx: PersistContext,
  payload: StreamEvent,
  agentMessageIds: Map<string, string>
) => {
  if (payload.eventType === "session" || payload.eventType === "step" || payload.eventType === "tool" || payload.eventType === "project_rename" || payload.eventType === "webcontainer_request") return;
  if (!ctx.enabled || !ctx.sessionId) return;
  if (payload.status === "streaming") return;

  const supabase = await createClient();
  const key = `${payload.agent}:${payload.name}`;
  const content = payload.content ?? "";

  if (payload.status === "thinking") {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({
        session_id: ctx.sessionId,
        role: "agent",
        agent_name: payload.name,
        agent_role: payload.agent,
        content,
        status: "thinking",
      })
      .select("id")
      .single();

    if (!error && data?.id) {
      agentMessageIds.set(key, data.id);
    }
    return;
  }

  if (payload.status === "done" || payload.status === "error") {
    const messageId = agentMessageIds.get(key);

    if (messageId) {
      await supabase
        .from("chat_messages")
        .update({ content, status: payload.status })
        .eq("id", messageId);
      return;
    }

    await supabase.from("chat_messages").insert({
      session_id: ctx.sessionId,
      role: "agent",
      agent_name: payload.name,
      agent_role: payload.agent,
      content,
      status: payload.status,
    });
  }
};

const emitEvent = async (
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: StreamEvent,
  persistCtx: PersistContext,
  agentMessageIds: Map<string, string>
) => {
  sendEvent(controller, encoder, payload);
  await upsertAgentMessage(persistCtx, payload, agentMessageIds);
};

const createToolCallId = (toolName: ToolEvent["toolName"]) => {
  return `${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeProjectFiles = (files: RequestProjectFile[] | undefined): ProjectFile[] => {
  if (!Array.isArray(files)) return [];

  return files
    .filter((file) => typeof file.path === "string" && typeof file.code === "string")
    .map((file) => ({ path: file.path, code: file.code }));
};

const normalizeFileTree = (items: RequestFileTreeItem[] | undefined): RequestFileTreeItem[] => {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item) => item && typeof item.path === "string")
    .map((item) => ({
      path: item.path,
      size: typeof item.size === "number" ? item.size : undefined,
      isActive: item.isActive === true,
      isDirty: item.isDirty === true,
      isRecentlyEdited: item.isRecentlyEdited === true,
    }));
};

const RECENT_HISTORY_LIMIT = 8;
const RECENT_HISTORY_CONTENT_LIMIT = 240;

const summarizeMessageContent = (content: string, maxLength = RECENT_HISTORY_CONTENT_LIMIT) => {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "[空内容]";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength)}...`;
};

const formatRecentConversationSummary = (messages: PersistedChatMessage[]) => {
  if (!messages.length) {
    return "";
  }

  const summaryLines = messages.map((item, index) => {
    const speaker = item.role === "user"
      ? "用户"
      : `${item.agent_name ?? "Agent"}${item.agent_role ? `(${item.agent_role})` : ""}`;

    return `${index + 1}. ${speaker}: ${summarizeMessageContent(item.content)}`;
  });

  return [`最近对话摘要（按时间顺序）:`, ...summaryLines].join("\n");
};

const loadRecentConversationSummary = async (
  supabase: SupabaseServerClient,
  sessionId: string | null,
  limit = RECENT_HISTORY_LIMIT
) => {
  if (!sessionId) {
    return "";
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, agent_name, agent_role, content, status, created_at")
    .eq("session_id", sessionId)
    .in("status", ["done", "error", "stopped"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to load recent conversation summary", error);
    return "";
  }

  const messages = ((data ?? []) as PersistedChatMessage[]).reverse();
  return formatRecentConversationSummary(messages);
};

const mergeProjectFiles = (baseFiles: ProjectFile[], overlayFiles: ProjectFile[]) => {
  const merged = new Map<string, string>();

  baseFiles.forEach((file) => {
    merged.set(file.path, file.code);
  });

  overlayFiles.forEach((file) => {
    merged.set(file.path, file.code);
  });

  return Array.from(merged.entries())
    .map(([path, code]) => ({ path, code }))
    .sort((left, right) => left.path.localeCompare(right.path));
};

const loadProjectFilesFromStorage = async (
  supabase: SupabaseServerClient,
  projectId?: string
) => {
  if (!projectId) {
    return [] as ProjectFile[];
  }

  const { data, error } = await supabase
    .from("project_files")
    .select("path, content")
    .eq("project_id", projectId)
    .order("path", { ascending: true });

  if (error) {
    console.error("Failed to load project files from storage", error);
    return [] as ProjectFile[];
  }

  return (data ?? [])
    .filter(
      (file): file is { path: string; content: string } =>
        typeof file.path === "string" && typeof file.content === "string"
    )
    .map((file) => ({ path: file.path, code: file.content }));
};

const buildFileTreeSummary = (
  fileTree: RequestFileTreeItem[],
  fallbackFiles: ProjectFile[],
  maxItems = 120
) => {
  const source: RequestFileTreeItem[] = fileTree.length
    ? fileTree
    : fallbackFiles.map((file) => ({ path: file.path, size: file.code.length }));

  if (!source.length) {
    return "当前项目暂无文件。";
  }

  const prioritized = [...source].sort((left, right) => {
    const leftScore = Number(left.isActive) * 4 + Number(left.isDirty) * 3 + Number(left.isRecentlyEdited) * 2;
    const rightScore = Number(right.isActive) * 4 + Number(right.isDirty) * 3 + Number(right.isRecentlyEdited) * 2;

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.path.localeCompare(right.path);
  });

  const visible = prioritized.slice(0, maxItems);
  const lines = visible.map((item) => {
    const tags = [
      item.isActive ? "active" : null,
      item.isDirty ? "dirty" : null,
      item.isRecentlyEdited ? "recent" : null,
    ].filter(Boolean);

    const tagBlock = tags.length ? ` [${tags.join(", ")}]` : "";
    const sizeBlock = typeof item.size === "number" ? ` (${item.size} chars)` : "";
    return `- ${item.path}${tagBlock}${sizeBlock}`;
  });

  if (prioritized.length > visible.length) {
    lines.push(`- ... 还有 ${prioritized.length - visible.length} 个文件未展开`);
  }

  return lines.join("\n");
};

const buildHotFilesContext = (files: ProjectFile[]) => {
  if (!files.length) {
    return "当前没有附带热文件全文；如需查看具体内容，请调用 wc.fs.readFile。";
  }

  return files
    .map((file) => [`FILE: ${file.path}`, file.code].join("\n"))
    .join("\n\n");
};

const BOOTSTRAP_FILE_PATHS = [
  "/package.json",
  "/index.html",
  "/main.tsx",
  "/index.css",
  "/App.tsx",
  "/todo.md",
];

const buildBootstrapFilesContext = (files: ProjectFile[]) => {
  const fileMap = new Map(files.map((file) => [file.path, file.code]));
  const existing = BOOTSTRAP_FILE_PATHS.filter((path) => fileMap.has(path));

  if (!existing.length) {
    return "当前没有可用的预置关键文件上下文。";
  }

  return existing
    .map((path) => [`FILE: ${path}`, fileMap.get(path) ?? ""].join("\n"))
    .join("\n\n");
};

const materializeProjectFiles = (
  fileMap: Map<string, string>,
  changedFiles: ProjectFile[],
  deletedPaths: string[] = []
) => {
  const materialized = new Map(fileMap);

  changedFiles.forEach((file) => {
    materialized.set(file.path, file.code);
  });

  deletedPaths.forEach((path) => {
    materialized.delete(path);
  });

  return Array.from(materialized.entries())
    .map(([path, code]) => ({ path, code }))
    .sort((left, right) => left.path.localeCompare(right.path));
};

const hasMeaningfulFileChange = (baseline: ProjectFile[], candidate: ProjectFile[]) => {
  const baselineMap = new Map<string, string>();
  baseline.forEach((file) => {
    baselineMap.set(file.path, file.code);
  });

  const candidateMap = new Map<string, string>();
  candidate.forEach((file) => {
    candidateMap.set(file.path, file.code);
  });

  if (baselineMap.size !== candidateMap.size) {
    return true;
  }

  return candidate.some((file) => baselineMap.get(file.path) !== file.code) || baseline.some((file) => !candidateMap.has(file.path));
};

const persistChangedProjectFiles = async ({
  supabase,
  projectId,
  baselineFiles,
  nextFiles,
}: {
  supabase: SupabaseServerClient;
  projectId?: string;
  baselineFiles: ProjectFile[];
  nextFiles: ProjectFile[];
}) => {
  if (!projectId) {
    return [] as Array<{ path: string; updated_at: string }>;
  }

  const baselineMap = new Map<string, string>();
  baselineFiles.forEach((file) => {
    baselineMap.set(file.path, file.code);
  });
  const nextPathSet = new Set(nextFiles.map((file) => file.path));

  const rowsToUpsert = nextFiles
    .filter((file) => baselineMap.get(file.path) !== file.code)
    .map((file) => ({
      project_id: projectId,
      path: file.path,
      content: file.code,
    }));

  const removedPaths = baselineFiles
    .filter((file) => !nextPathSet.has(file.path))
    .map((file) => file.path);

  if (rowsToUpsert.length) {
    const { error: upsertError } = await supabase
      .from("project_files")
      .upsert(rowsToUpsert, { onConflict: "project_id,path" });

    if (upsertError) {
      throw new Error(`持久化 project_files 失败: ${upsertError.message}`);
    }
  }

  if (removedPaths.length) {
    const { error: deleteError } = await supabase
      .from("project_files")
      .delete()
      .eq("project_id", projectId)
      .in("path", removedPaths);

    if (deleteError) {
      throw new Error(`删除 project_files 失败: ${deleteError.message}`);
    }
  }

  if (!rowsToUpsert.length) {
    return [] as Array<{ path: string; updated_at: string }>;
  }

  const changedPaths = rowsToUpsert.map((row) => row.path);
  const { data, error: queryError } = await supabase
    .from("project_files")
    .select("path, updated_at")
    .eq("project_id", projectId)
    .in("path", changedPaths);

  if (queryError) {
    throw new Error(`读取 project_files 时间戳失败: ${queryError.message}`);
  }

  return (data ?? []).filter(
    (row): row is { path: string; updated_at: string } =>
      typeof row.path === "string" && typeof row.updated_at === "string"
  );
};

const parseToolLoopDecision = (content: string): ToolLoopDecision => {
  const parsed = parseJSONFromLLM(content) as unknown;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("工具决策输出不是对象");
  }

  const record = parsed as Record<string, unknown>;
  const action = record.action;

  if (action === "tool_call") {
    const tool = record.tool;
    const input = record.input;

    const allowedTools: WebContainerToolName[] = [
      "wc.fs.readFile",
      "wc.fs.writeFile",
      "wc.fs.readdir",
      "wc.fs.mkdir",
      "wc.fs.rm",
      "wc.spawn",
      "wc.readProcess",
      "wc.killProcess",
    ];

    if (!allowedTools.includes(tool as WebContainerToolName) || !input || typeof input !== "object") {
      throw new Error("工具调用参数不合法");
    }

    const inputRecord = input as Record<string, unknown>;
    const path = typeof inputRecord.path === "string" ? inputRecord.path : undefined;
    const contentValue = inputRecord.content;
    const command = typeof inputRecord.command === "string" ? inputRecord.command : undefined;
    const procId = typeof inputRecord.procId === "string" ? inputRecord.procId : undefined;

    if ((tool === "wc.fs.readFile" || tool === "wc.fs.writeFile" || tool === "wc.fs.readdir" || tool === "wc.fs.mkdir" || tool === "wc.fs.rm") && (!path || !path.trim())) {
      throw new Error(`${tool} 缺少 path`);
    }

    if (tool === "wc.fs.writeFile" && typeof contentValue !== "string") {
      throw new Error("wc.fs.writeFile 需要字符串 content");
    }

    if (tool === "wc.spawn" && !command) {
      throw new Error("wc.spawn 缺少 command");
    }

    if ((tool === "wc.readProcess" || tool === "wc.killProcess") && !procId) {
      throw new Error(`${tool} 缺少 procId`);
    }

    return {
      action: "tool_call",
      tool: tool as WebContainerToolName,
      input: {
        path,
        encoding: inputRecord.encoding === "utf-8" ? "utf-8" : undefined,
        content: typeof contentValue === "string" ? contentValue : undefined,
        recursive: inputRecord.recursive === true,
        command,
        args: Array.isArray(inputRecord.args)
          ? inputRecord.args.filter((arg): arg is string => typeof arg === "string")
          : undefined,
        cwd: typeof inputRecord.cwd === "string" ? inputRecord.cwd : undefined,
        waitForExit: inputRecord.waitForExit === true,
        procId,
      },
      reason: typeof record.reason === "string" ? record.reason : undefined,
    };
  }

  if (action === "final") {
    const files = record.files;
    const deletedPaths = Array.isArray(record.deletedPaths)
      ? record.deletedPaths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      : [];

    if (!Array.isArray(files)) {
      throw new Error("final 输出缺少 files 数组");
    }

    return {
      action: "final",
      files: files
        .filter(
          (file): file is { path: string; code: string } =>
            Boolean(file) &&
            typeof file === "object" &&
            typeof (file as { path?: unknown }).path === "string" &&
            typeof (file as { code?: unknown }).code === "string"
        )
        .map((file) => ({ path: file.path, code: file.code })),
      deletedPaths,
      summary: typeof record.summary === "string" ? record.summary : undefined,
    };
  }

  throw new Error("未知工具决策 action");
};

const tryParsePartialToolLoopDecision = (content: string) => {
  try {
    const parsed = parsePartialJson(content, Allow.OBJ | Allow.ARR | Allow.STR) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;

    return {
      action: typeof record.action === "string" ? record.action : undefined,
      tool: typeof record.tool === "string" ? record.tool : undefined,
      path:
        record.input && typeof record.input === "object" && typeof (record.input as { path?: unknown }).path === "string"
          ? (record.input as { path: string }).path
          : undefined,
    };
  } catch {
    return null;
  }
};

const createBridgeRequestInput = (
  tool: WebContainerToolName,
  input: ToolCallInput
): WebContainerToolInputMap[WebContainerToolName] => {
  switch (tool) {
    case "wc.fs.readFile":
      return { path: input.path ?? "", encoding: input.encoding ?? "utf-8" };
    case "wc.fs.writeFile":
      return { path: input.path ?? "", content: input.content ?? "" };
    case "wc.fs.readdir":
      return { path: input.path ?? "/" };
    case "wc.fs.mkdir":
      return { path: input.path ?? "/" };
    case "wc.fs.rm":
      return { path: input.path ?? "", recursive: input.recursive === true };
    case "wc.spawn":
      return {
        command: input.command ?? "",
        args: input.args ?? [],
        cwd: input.cwd,
        waitForExit: input.waitForExit === true,
      };
    case "wc.readProcess":
      return { procId: input.procId ?? "" };
    case "wc.killProcess":
      return { procId: input.procId ?? "" };
  }
};

const formatBridgeToolResult = (
  tool: WebContainerToolName,
  result: WebContainerBridgeResult,
  input: ToolCallInput
) => {
  if (!result.ok) {
    return {
      ok: false,
      tool,
      path: input.path,
      procId: input.procId,
      error: result.error,
      detail: result.detail,
    };
  }

  return {
    ok: true,
    tool,
    path: input.path,
    procId: input.procId,
    detail: result.detail,
    data: result.data,
  };
};

type FileToolLoopParams = {
  llm: ChatOpenAI;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  persistCtx: PersistContext;
  agentMessageIds: Map<string, string>;
  agentType: "engineer";
  agentName: string;
  rootToolCallId: string;
  rootToolName: "execute_task";
  taskInput: string;
  initialFiles: ProjectFile[];
  requireTodoUpdate?: boolean;
  maxRounds?: number;
};

const runFileToolLoop = async ({
  llm,
  controller,
  encoder,
  persistCtx,
  agentMessageIds,
  agentType,
  agentName,
  rootToolCallId,
  rootToolName,
  taskInput,
  initialFiles,
  requireTodoUpdate = false,
  maxRounds = 4,
}: FileToolLoopParams): Promise<FileToolLoopResult> => {
  const fileMap = new Map<string, string>();
  initialFiles.forEach((file) => fileMap.set(file.path, file.code));
  const initialTodo = fileMap.get("/todo.md") ?? null;

  const toolLoopMessages: Array<HumanMessage | SystemMessage> = [
    new SystemMessage(buildEngineerToolLoopPrompt(agentName)),
    new HumanMessage(taskInput),
  ];

  let projectFilesResult: ProjectFile[] = [];
  let summary: string | undefined;
  let finalized = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    sendEvent(controller, encoder, {
      eventType: "tool",
      callId: rootToolCallId,
      action: "tool_input_delta",
      toolName: rootToolName,
      detail: `工具闭环第 ${round} 轮`,
    });

    const loopText = await invokeWithStream(
      llm,
      toolLoopMessages,
      agentType,
      agentName,
      controller,
      encoder,
      persistCtx,
      agentMessageIds,
      {
        callId: rootToolCallId,
        toolName: rootToolName,
      }
    );

    let decision: ToolLoopDecision;
    try {
      decision = parseToolLoopDecision(loopText);
    } catch (error) {
      sendEvent(controller, encoder, {
        eventType: "tool",
        callId: rootToolCallId,
        action: "tool_error",
        toolName: rootToolName,
        detail: error instanceof Error ? error.message : "工具闭环解析失败",
      });
      break;
    }

    toolLoopMessages.push(new SystemMessage(`上一轮输出:\n${loopText}`));

    if (decision.action === "final") {
      const candidateFiles = materializeProjectFiles(
        fileMap,
        decision.files,
        decision.deletedPaths
      );
      const candidateTodo = candidateFiles.find((file) => file.path === "/todo.md")?.code ?? null;

      if (!hasMeaningfulFileChange(initialFiles, candidateFiles)) {
        sendEvent(controller, encoder, {
          eventType: "tool",
          callId: rootToolCallId,
          action: "tool_input_delta",
          toolName: rootToolName,
          detail: "检测到 final 未包含有效代码改动，继续迭代",
        });

        toolLoopMessages.push(
          new HumanMessage(
            "校验失败：你提交的 final 与输入文件相比没有任何有效改动。请继续调用 wc.fs.readFile / wc.fs.writeFile / wc.fs.rm，并在 final 中仅输出真实变更文件或 deletedPaths。"
          )
        );
        continue;
      }

      if (requireTodoUpdate && candidateTodo === initialTodo) {
        sendEvent(controller, encoder, {
          eventType: "tool",
          callId: rootToolCallId,
          action: "tool_input_delta",
          toolName: rootToolName,
          detail: "检测到 /todo.md 未更新，继续迭代",
        });

        toolLoopMessages.push(
          new HumanMessage(
            "校验失败：这轮属于开发或修复任务，你必须先创建或更新根目录 /todo.md，并让内容真实反映本轮任务，再提交 final。"
          )
        );
        continue;
      }

      finalized = true;
      projectFilesResult = candidateFiles;
      summary = decision.summary;
      break;
    }

    const callId = createToolCallId(decision.tool);
    sendEvent(controller, encoder, {
      eventType: "tool",
      callId,
      action: "tool_start",
      toolName: decision.tool,
      detail: decision.reason ?? `调用 ${decision.tool}`,
    });

    const bridge = createWebContainerBridgeRequest(
      decision.tool,
      createBridgeRequestInput(decision.tool, decision.input) as WebContainerToolInputMap[typeof decision.tool]
    );

    sendEvent(controller, encoder, {
      eventType: "webcontainer_request",
      request: bridge.request,
    });

    let bridgeResult: WebContainerBridgeResult;
    try {
      bridgeResult = await bridge.resultPromise;
    } catch (error) {
      sendEvent(controller, encoder, {
        eventType: "tool",
        callId,
        action: "tool_error",
        toolName: decision.tool,
        detail: error instanceof Error ? error.message : "WebContainer bridge 调用失败",
      });

      toolLoopMessages.push(
        new HumanMessage(
          `工具结果(${decision.tool}): ${JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : "bridge_failed",
          })}`
        )
      );
      continue;
    }

    if (bridgeResult.ok) {
      if (decision.tool === "wc.fs.writeFile" && decision.input.path) {
        fileMap.set(decision.input.path, decision.input.content ?? "");
      }

      if (decision.tool === "wc.fs.rm" && decision.input.path) {
        fileMap.delete(decision.input.path);
        for (const existingPath of Array.from(fileMap.keys())) {
          if (existingPath.startsWith(`${decision.input.path}/`)) {
            fileMap.delete(existingPath);
          }
        }
      }

      sendEvent(controller, encoder, {
        eventType: "tool",
        callId,
        action: "tool_result",
        toolName: decision.tool,
        detail: bridgeResult.detail ?? `${decision.tool} 执行成功`,
      });
    } else {
      sendEvent(controller, encoder, {
        eventType: "tool",
        callId,
        action: "tool_error",
        toolName: decision.tool,
        detail: bridgeResult.detail ?? bridgeResult.error,
      });
    }

    toolLoopMessages.push(
      new HumanMessage(
        `工具结果(${decision.tool}): ${JSON.stringify(
          formatBridgeToolResult(decision.tool, bridgeResult, decision.input)
        )}`
      )
    );
  }

  if (!finalized) {
    const fallbackFiles = Array.from(fileMap.entries()).map(([path, code]) => ({ path, code }));
    projectFilesResult = fallbackFiles.length ? fallbackFiles : initialFiles;
  }

  return {
    projectFiles: projectFilesResult,
    summary,
  };
};

const invokeWithStream = async (
  llm: ChatOpenAI,
  messages: Array<HumanMessage | SystemMessage>,
  agentType: "engineer",
  agentName: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  persistCtx: PersistContext,
  agentMessageIds: Map<string, string>,
  toolContext?: { callId: string; toolName: ToolEvent["toolName"] }
) => {
  const stream = await llm.stream(normalizeMessagesForProvider(messages));
  let fullContent = "";
  let lastDeltaLength = 0;
  let lastPreview = "";
  for await (const chunk of stream) {
    const textChunk = typeof chunk.content === "string" ? chunk.content : "";
    if (!textChunk) continue;
    fullContent += textChunk;

    if (toolContext && fullContent.length - lastDeltaLength >= 220) {
      lastDeltaLength = fullContent.length;

      let detail = `处理中... ${fullContent.length} 字符`;
      const partial = tryParsePartialToolLoopDecision(fullContent);
      if (partial?.action === "tool_call") {
        const toolLabel = partial.tool ?? "unknown";
        const pathLabel = partial.path ? ` (${partial.path})` : "";
        detail = `候选调用: ${toolLabel}${pathLabel}`;
      }

      if (partial?.action === "final") {
        detail = "候选状态: final";
      }

      if (detail === lastPreview) {
        detail = `处理中... ${fullContent.length} 字符`;
      }
      lastPreview = detail;

      sendEvent(controller, encoder, {
        eventType: "tool",
        callId: toolContext.callId,
        action: "tool_input_delta",
        toolName: toolContext.toolName,
        detail,
      });
    }
    
    await emitEvent(controller, encoder, {
      agent: agentType,
      name: agentName,
      status: "streaming",
      content: cleanThinkTags(fullContent),
    }, persistCtx, agentMessageIds);
  }
  return cleanThinkTags(fullContent);
};

export async function POST(req: Request) {
  try {
    const {
      message,
      errorMessage,
      projectFiles: requestProjectFiles,
      hotFiles: requestHotFiles,
      fileTree: requestFileTree,
      projectId,
      sessionId,
      isNewProject,
    } = (await req.json()) as RequestBody;

    const legacyProjectFiles = normalizeProjectFiles(requestProjectFiles);
    const hotFiles = normalizeProjectFiles(requestHotFiles);
    const fileTree = normalizeFileTree(requestFileTree);

    if (!message && !errorMessage) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const supabase = await createClient();
          const persistedProjectFiles = await loadProjectFilesFromStorage(supabase, projectId);
          const baseProjectFiles = persistedProjectFiles.length ? persistedProjectFiles : legacyProjectFiles;
          const effectiveHotFiles = hotFiles.length ? hotFiles : legacyProjectFiles;
          const projectFiles = mergeProjectFiles(baseProjectFiles, effectiveHotFiles);
          const fileTreeSummary = buildFileTreeSummary(fileTree, projectFiles);
          const hotFilesContext = buildHotFilesContext(effectiveHotFiles);
          const bootstrapFilesContext = buildBootstrapFilesContext(projectFiles);
          let activeSessionId: string | null = sessionId ?? null;
          const agentMessageIds = new Map<string, string>();

          if (projectId && !activeSessionId) {
            const { data } = await supabase
              .from("chat_sessions")
              .insert({ project_id: projectId })
              .select("id")
              .single();

            activeSessionId = data?.id ?? null;
          }

          if (activeSessionId) {
            sendEvent(controller, encoder, {
              eventType: "session",
              sessionId: activeSessionId,
            });
          }

          const recentConversationSummary = await loadRecentConversationSummary(
            supabase,
            activeSessionId
          );

          const persistCtx: PersistContext = {
            enabled: Boolean(projectId && activeSessionId),
            sessionId: activeSessionId,
            userMessage: typeof message === "string" ? message : null,
          };

          if (persistCtx.enabled && persistCtx.userMessage) {
            await supabase.from("chat_messages").insert({
              session_id: persistCtx.sessionId,
              role: "user",
              content: persistCtx.userMessage,
              status: "done",
            });
          }

          const llm = createModel();

          let routeDecision: EngineerRouteDecision;

          if (errorMessage) {
            routeDecision = {
              mode: "fix",
              intentSummary: "修复当前项目中的错误",
              reply: "",
              executionBrief: errorMessage,
              projectName: "",
              shouldWriteTodo: true,
            };
          } else {
            const routeToolCallId = createToolCallId("route_request");
            sendEvent(controller, encoder, {
              eventType: "step",
              stepId: "route",
              title: "任务判断",
              status: "running",
              detail: "工程师正在判断这是聊天还是开发任务",
            });

            sendEvent(controller, encoder, {
              eventType: "tool",
              callId: routeToolCallId,
              action: "tool_start",
              toolName: "route_request",
              detail: "分析用户输入并决定是否进入开发闭环",
            });

            await emitEvent(controller, encoder, {
              agent: "engineer",
              name: "Alex",
              status: "thinking",
              content: "我先判断这轮是普通聊天，还是要继续进入开发。",
            }, persistCtx, agentMessageIds);

            const hasExistingFiles = projectFiles.length > 0;
            const routeContextBlock = [
              recentConversationSummary || "最近没有可用的历史对话。",
              hasExistingFiles
                ? `当前项目已有 ${projectFiles.length} 个文件。`
                : isNewProject
                ? "这是从首页进入的新项目流程。"
                : "当前项目暂无文件。",
              `当前项目文件树:\n${fileTreeSummary}`,
              `预置关键文件全文:\n${bootstrapFilesContext}`,
            ].join("\n\n");

            const routeResponse = await llm.invoke(
              normalizeMessagesForProvider([
                new SystemMessage(buildEngineerRoutePrompt(routeContextBlock)),
                new HumanMessage(`用户输入:\n${message ?? ""}`),
              ])
            );

            try {
              const parsed = parseJSONFromLLM(routeResponse.content as string) as Partial<EngineerRouteDecision>;
              routeDecision = {
                mode:
                  parsed.mode === "build" ||
                  parsed.mode === "modify" ||
                  parsed.mode === "resume" ||
                  parsed.mode === "fix"
                    ? parsed.mode
                    : "chat",
                intentSummary: typeof parsed.intentSummary === "string" ? parsed.intentSummary : "处理当前用户请求",
                reply: typeof parsed.reply === "string" ? parsed.reply : "",
                executionBrief: typeof parsed.executionBrief === "string" ? parsed.executionBrief : "",
                projectName: typeof parsed.projectName === "string" ? parsed.projectName.trim() : "",
                shouldWriteTodo: parsed.shouldWriteTodo !== false,
              };
            } catch (error) {
              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: routeToolCallId,
                action: "tool_error",
                toolName: "route_request",
                detail: error instanceof Error ? error.message : "任务判断解析失败",
              });
              throw error;
            }

            sendEvent(controller, encoder, {
              eventType: "tool",
              callId: routeToolCallId,
              action: "tool_result",
              toolName: "route_request",
              detail: `已识别模式: ${routeDecision.mode}`,
            });

            sendEvent(controller, encoder, {
              eventType: "step",
              stepId: "route",
              title: "任务判断",
              status: "done",
              detail: `${routeDecision.mode} · ${routeDecision.intentSummary}`,
            });
          }

          if (routeDecision.mode === "chat") {
            const replyText = await invokeWithStream(
              llm,
              [
                new SystemMessage(ENGINEER_CHAT_REPLY_PROMPT),
                new HumanMessage(
                  `${recentConversationSummary ? `${recentConversationSummary}\n\n` : ""}用户当前输入:\n${message ?? ""}`
                ),
              ],
              "engineer",
              "Alex",
              controller,
              encoder,
              persistCtx,
              agentMessageIds
            );

            await emitEvent(controller, encoder, {
              agent: "engineer",
              name: "Alex",
              status: "done",
              content: routeDecision.reply || replyText,
            }, persistCtx, agentMessageIds);

            controller.close();
            return;
          }

          if (routeDecision.mode === "build" && routeDecision.projectName) {
            sendEvent(controller, encoder, {
              eventType: "project_rename",
              projectName: routeDecision.projectName,
            });
          }

          const executeToolCallId = createToolCallId("execute_task");
          sendEvent(controller, encoder, {
            eventType: "step",
            stepId: "execute",
            title: "工程执行",
            status: "running",
            detail: `工程师正在处理 ${routeDecision.mode} 任务`,
          });

          sendEvent(controller, encoder, {
            eventType: "tool",
            callId: executeToolCallId,
            action: "tool_start",
            toolName: "execute_task",
            detail: "读取项目上下文并进入开发闭环",
          });

          await emitEvent(controller, encoder, {
            agent: "engineer",
            name: "Alex",
            status: "thinking",
            content:
              routeDecision.mode === "fix"
                ? "我先修复当前问题，并同步更新 todo 和代码。"
                : "我先整理任务并更新 todo，然后开始改代码。",
          }, persistCtx, agentMessageIds);

          const executionTaskInput = [
            `当前模式: ${routeDecision.mode}`,
            `本轮目标: ${routeDecision.intentSummary}`,
            routeDecision.executionBrief
              ? `执行说明:\n${routeDecision.executionBrief}`
              : `用户原始输入:\n${message ?? ""}`,
            errorMessage ? `错误信息:\n${errorMessage}` : "",
            recentConversationSummary,
            `当前项目文件树:\n${fileTreeSummary}`,
            `预置关键文件全文:\n${bootstrapFilesContext}`,
            `热文件全文:\n${hotFilesContext}`,
            "要求：先创建或更新根目录 /todo.md，再进行代码修改；任务完成后用中文输出面向用户的完成报告；final 中只输出真实变更文件和 deletedPaths。",
          ]
            .filter(Boolean)
            .join("\n\n");

          const executionResult = await runFileToolLoop({
            llm,
            controller,
            encoder,
            persistCtx,
            agentMessageIds,
            agentType: "engineer",
            agentName: "Alex",
            rootToolCallId: executeToolCallId,
            rootToolName: "execute_task",
            initialFiles: projectFiles,
            taskInput: executionTaskInput,
            requireTodoUpdate: routeDecision.shouldWriteTodo,
            maxRounds: 5,
          });

          const hasFileChanges = hasMeaningfulFileChange(projectFiles, executionResult.projectFiles);
          let fileTimestamps: Array<{ path: string; updated_at: string }> = [];

          if (hasFileChanges) {
            sendEvent(controller, encoder, {
              eventType: "tool",
              callId: executeToolCallId,
              action: "tool_input_delta",
              toolName: "execute_task",
              detail: "检测到改动，正在同步到 Supabase",
            });

            try {
              fileTimestamps = await persistChangedProjectFiles({
                supabase,
                projectId,
                baselineFiles: projectFiles,
                nextFiles: executionResult.projectFiles,
              });
            } catch (error) {
              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: executeToolCallId,
                action: "tool_error",
                toolName: "execute_task",
                detail: error instanceof Error ? error.message : "同步项目文件到 Supabase 失败",
              });
            }
          }

          sendEvent(controller, encoder, {
            eventType: "tool",
            callId: executeToolCallId,
            action: "tool_result",
            toolName: "execute_task",
            detail: hasFileChanges
              ? `执行完成，当前项目文件数: ${executionResult.projectFiles.length}`
              : "执行完成，但未检测到有效文件改动",
          });

          await emitEvent(controller, encoder, {
            agent: "engineer",
            name: "Alex",
            status: "done",
            content:
              executionResult.summary ||
              (hasFileChanges
                ? "本轮任务已完成，代码和项目文件已经同步。"
                : "本轮没有形成有效文件改动，请补充更具体的需求。"),
            projectFiles: executionResult.projectFiles,
            fileTimestamps,
          }, persistCtx, agentMessageIds);

          sendEvent(controller, encoder, {
            eventType: "step",
            stepId: "execute",
            title: "工程执行",
            status: hasFileChanges ? "done" : "error",
            detail: hasFileChanges ? "本轮任务已完成" : "未检测到有效文件改动",
          });

          controller.close();
        } catch (streamError) {
          console.error("====== AGENT STREAM ERROR ======");
          console.error(streamError);
          sendEvent(controller, encoder, {
            eventType: "tool",
            callId: createToolCallId("execute_task"),
            action: "tool_error",
            toolName: "execute_task",
            detail: streamError instanceof Error ? streamError.message : "未知错误",
          });
          sendEvent(controller, encoder, {
            eventType: "step",
            stepId: "execute",
            title: "工程执行",
            status: "error",
            detail: "流处理失败",
          });
          sendEvent(controller, encoder, {
            agent: "engineer",
            name: "Alex",
            status: "error",
            content: "生成失败，请稍后重试。",
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Connection": "keep-alive",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

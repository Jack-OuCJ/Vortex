import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Allow, parse as parsePartialJson } from "partial-json";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProjectFile = {
  path: string;
  code: string;
};

type AgentEvent = {
  eventType?: "agent";
  agent: "pm" | "architect" | "engineer" | "debug";
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
  stepId: "pm" | "architect" | "engineer" | "debug" | "direct_reply";
  title: string;
  status: "running" | "done" | "error";
  detail?: string;
};

type ToolEvent = {
  eventType: "tool";
  callId: string;
  action: "tool_start" | "tool_input_delta" | "tool_result" | "tool_error";
  toolName:
    | "analyze_demand"
    | "plan_architecture"
    | "generate_project_files"
    | "debug_fix"
    | "read_file"
    | "write_file";
  detail?: string;
};

type StreamEvent = AgentEvent | SessionEvent | StepEvent | ToolEvent;

type RequestProjectFile = {
  path: string;
  code: string;
};

type RequestBody = {
  message?: string;
  errorMessage?: string;
  projectFiles?: RequestProjectFile[];
  projectId?: string;
  sessionId?: string;
};

type ToolLoopDecision =
  | {
      action: "tool_call";
      tool: "read_file" | "write_file";
      input: {
        path: string;
        content?: string;
      };
      reason?: string;
    }
  | {
      action: "final";
      files: ProjectFile[];
      summary?: string;
    };

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
  if (payload.eventType === "session" || payload.eventType === "step" || payload.eventType === "tool") return;
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

const stringifyProjectFiles = (files: ProjectFile[]) => {
  return JSON.stringify(
    files.map((file) => ({ path: file.path, code: file.code })),
    null,
    2
  );
};

const hasMeaningfulFileChange = (baseline: ProjectFile[], candidate: ProjectFile[]) => {
  if (!candidate.length) {
    return false;
  }

  const baselineMap = new Map<string, string>();
  baseline.forEach((file) => {
    baselineMap.set(file.path, file.code);
  });

  return candidate.some((file) => baselineMap.get(file.path) !== file.code);
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

  const rowsToUpsert = nextFiles
    .filter((file) => baselineMap.get(file.path) !== file.code)
    .map((file) => ({
      project_id: projectId,
      path: file.path,
      content: file.code,
    }));

  if (!rowsToUpsert.length) {
    return [] as Array<{ path: string; updated_at: string }>;
  }

  const { error: upsertError } = await supabase
    .from("project_files")
    .upsert(rowsToUpsert, { onConflict: "project_id,path" });

  if (upsertError) {
    throw new Error(`持久化 project_files 失败: ${upsertError.message}`);
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

    if ((tool !== "read_file" && tool !== "write_file") || !input || typeof input !== "object") {
      throw new Error("工具调用参数不合法");
    }

    const inputRecord = input as Record<string, unknown>;
    const path = inputRecord.path;

    if (typeof path !== "string" || !path.trim()) {
      throw new Error("工具调用缺少 path");
    }

    const contentValue = inputRecord.content;

    if (tool === "write_file" && typeof contentValue !== "string") {
      throw new Error("write_file 需要字符串 content");
    }

    return {
      action: "tool_call",
      tool,
      input: {
        path,
        content: typeof contentValue === "string" ? contentValue : undefined,
      },
      reason: typeof record.reason === "string" ? record.reason : undefined,
    };
  }

  if (action === "final") {
    const files = record.files;

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

type FileToolLoopParams = {
  llm: ChatOpenAI;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  persistCtx: PersistContext;
  agentMessageIds: Map<string, string>;
  agentType: "engineer" | "debug";
  agentName: string;
  rootToolCallId: string;
  rootToolName: "generate_project_files" | "debug_fix";
  taskInput: string;
  initialFiles: ProjectFile[];
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
  maxRounds = 4,
}: FileToolLoopParams): Promise<ProjectFile[]> => {
  const fileMap = new Map<string, string>();
  initialFiles.forEach((file) => fileMap.set(file.path, file.code));

  const toolLoopMessages: Array<HumanMessage | SystemMessage> = [
    new SystemMessage(
      [
        `你是工程师 ${agentName}。你需要分轮次完成代码修改。`,
        "你可以调用两个工具：",
        '1) read_file: {"path":"/App.tsx"}',
        '2) write_file: {"path":"/App.tsx","content":"..."}',
        "每一轮你只能输出一个严格 JSON 对象，不允许包含 Markdown。",
        '当需要调用工具时输出: {"action":"tool_call","tool":"read_file|write_file","input":{...},"reason":"..."}',
        '当任务完成时输出: {"action":"final","summary":"...","files":[{"path":"/App.tsx","code":"..."}]}',
        "如果要写文件，优先先 read_file 再 write_file。",
        "files 需包含完整最终文件集合（至少包含你改动过的文件）。",
      ].join("\n")
    ),
    new HumanMessage(taskInput),
  ];

  let projectFilesResult: ProjectFile[] = [];
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
      const candidateFiles = decision.files.length
        ? decision.files
        : Array.from(fileMap.entries()).map(([path, code]) => ({ path, code }));

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
            "校验失败：你提交的 final 与输入文件相比没有任何有效改动。请继续调用 read_file / write_file，并输出包含真实改动的 final。"
          )
        );
        continue;
      }

      finalized = true;
      projectFilesResult = candidateFiles;
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

    if (decision.tool === "read_file") {
      const content = fileMap.get(decision.input.path);
      if (typeof content === "string") {
        sendEvent(controller, encoder, {
          eventType: "tool",
          callId,
          action: "tool_result",
          toolName: "read_file",
          detail: `${decision.input.path} 已读取 (${content.length} 字符)`,
        });

        toolLoopMessages.push(
          new HumanMessage(
            `工具结果(read_file): ${JSON.stringify({
              ok: true,
              path: decision.input.path,
              content,
            })}`
          )
        );
      } else {
        sendEvent(controller, encoder, {
          eventType: "tool",
          callId,
          action: "tool_error",
          toolName: "read_file",
          detail: `${decision.input.path} 不存在`,
        });

        toolLoopMessages.push(
          new HumanMessage(
            `工具结果(read_file): ${JSON.stringify({
              ok: false,
              path: decision.input.path,
              error: "file_not_found",
            })}`
          )
        );
      }

      continue;
    }

    const content = decision.input.content ?? "";
    fileMap.set(decision.input.path, content);
    sendEvent(controller, encoder, {
      eventType: "tool",
      callId,
      action: "tool_result",
      toolName: "write_file",
      detail: `${decision.input.path} 已写入 (${content.length} 字符)`,
    });

    toolLoopMessages.push(
      new HumanMessage(
        `工具结果(write_file): ${JSON.stringify({
          ok: true,
          path: decision.input.path,
          length: content.length,
        })}`
      )
    );
  }

  if (!finalized) {
    const fallbackFiles = Array.from(fileMap.entries()).map(([path, code]) => ({ path, code }));
    projectFilesResult = fallbackFiles.length ? fallbackFiles : initialFiles;
  }

  return projectFilesResult;
};

const invokeWithStream = async (
  llm: ChatOpenAI,
  messages: Array<HumanMessage | SystemMessage>,
  agentType: "pm" | "architect" | "engineer" | "debug",
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
      projectId,
      sessionId,
    } = (await req.json()) as RequestBody;

    const projectFiles = normalizeProjectFiles(requestProjectFiles);

    if (!message && !errorMessage) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const supabase = await createClient();
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

          if (errorMessage) {
            const debugToolCallId = createToolCallId("debug_fix");
            sendEvent(controller, encoder, {
              eventType: "step",
              stepId: "debug",
              title: "调试修复",
              status: "running",
              detail: "正在根据错误信息生成修复方案",
            });

            sendEvent(controller, encoder, {
              eventType: "tool",
              callId: debugToolCallId,
              action: "tool_start",
              toolName: "debug_fix",
              detail: "读取错误信息并准备生成修复补丁",
            });

            await emitEvent(controller, encoder, {
              agent: "debug",
              name: "Alex",
              status: "thinking",
              content: "正在定位沙箱错误并生成修复方案...",
            }, persistCtx, agentMessageIds);

            const debugFiles = await runFileToolLoop({
              llm,
              controller,
              encoder,
              persistCtx,
              agentMessageIds,
              agentType: "debug",
              agentName: "Alex",
              rootToolCallId: debugToolCallId,
              rootToolName: "debug_fix",
              initialFiles: projectFiles,
              taskInput: `错误信息:\n${errorMessage}\n\n当前文件(JSON):\n${JSON.stringify(projectFiles, null, 2)}\n\n请逐步修复并输出 final。`,
              maxRounds: 4,
            });

            const hasDebugFileChanges = hasMeaningfulFileChange(projectFiles, debugFiles);
            let debugFileTimestamps: Array<{ path: string; updated_at: string }> = [];

            if (hasDebugFileChanges) {
              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: debugToolCallId,
                action: "tool_input_delta",
                toolName: "debug_fix",
                detail: "检测到修复改动，正在同步到 Supabase",
              });

              try {
                debugFileTimestamps = await persistChangedProjectFiles({
                  supabase,
                  projectId,
                  baselineFiles: projectFiles,
                  nextFiles: debugFiles,
                });
              } catch (error) {
                sendEvent(controller, encoder, {
                  eventType: "tool",
                  callId: debugToolCallId,
                  action: "tool_error",
                  toolName: "debug_fix",
                  detail:
                    error instanceof Error ? error.message : "同步修复文件到 Supabase 失败",
                });
              }
            }

            sendEvent(controller, encoder, {
              eventType: "tool",
              callId: debugToolCallId,
              action: "tool_result",
              toolName: "debug_fix",
              detail: hasDebugFileChanges
                ? `已生成并同步 ${Array.isArray(debugFiles) ? debugFiles.length : 0} 个修复文件`
                : `已生成 ${Array.isArray(debugFiles) ? debugFiles.length : 0} 个文件修复结果`,
            });

            await emitEvent(controller, encoder, {
              agent: "debug",
              name: "Alex",
              status: "done",
              content: "修复完成，正在更新沙箱。",
              projectFiles: debugFiles,
              fileTimestamps: debugFileTimestamps,
            }, persistCtx, agentMessageIds);

            sendEvent(controller, encoder, {
              eventType: "step",
              stepId: "debug",
              title: "调试修复",
              status: "done",
              detail: "调试阶段完成",
            });

            controller.close();
            return;
          }

          const stateSchema = Annotation.Root({
            prd: Annotation<string>(),
            architecture: Annotation<string>(),
            projectFiles: Annotation<ProjectFile[]>(),
            isAppDemand: Annotation<boolean>(),
            reply: Annotation<string>(),
          });

          const graph = new StateGraph(stateSchema)
            .addNode("pm", async () => {
              const analyzeToolCallId = createToolCallId("analyze_demand");
              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "pm",
                title: "需求分析",
                status: "running",
                detail: "产品经理正在分析任务意图",
              });

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: analyzeToolCallId,
                action: "tool_start",
                toolName: "analyze_demand",
                detail: "解析用户输入并判断是否为应用开发请求",
              });

              await emitEvent(controller, encoder, {
                agent: "pm",
                name: "Emma",
                status: "thinking",
                content: "我正在初判你的需求...",
              }, persistCtx, agentMessageIds);

              const pmMessages = normalizeMessagesForProvider([
                new SystemMessage(
                  "分析用户的后续任务。如果对方要求建立或修改前端网页/应用，将其整理成一段简要 PRD。如果是任何其它纯文字闲聊或知识提问，不用整理。仅可输出严格的 JSON 格式:\n{ \"isAppDemand\": boolean, \"prd\": \"string\" }"
                ),
                new HumanMessage(`用户输入:\n${message}`)
              ]);
              const pmObj = await llm.invoke(pmMessages);
              let result: { isAppDemand?: boolean; prd?: string; reply?: string };
              try {
                result = parseJSONFromLLM(pmObj.content as string) as {
                  isAppDemand?: boolean;
                  prd?: string;
                  reply?: string;
                };
              } catch (error) {
                sendEvent(controller, encoder, {
                  eventType: "tool",
                  callId: analyzeToolCallId,
                  action: "tool_error",
                  toolName: "analyze_demand",
                  detail: error instanceof Error ? error.message : "解析需求结果失败",
                });
                throw error;
              }

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: analyzeToolCallId,
                action: "tool_result",
                toolName: "analyze_demand",
                detail: result.isAppDemand ? "识别为应用开发请求" : "识别为直接问答请求",
              });

              if (result.isAppDemand) {
                await emitEvent(controller, encoder, {
                  agent: "pm",
                  name: "Emma",
                  status: "done",
                  content: "已确认需求场景，正在启动应用架构设计...",
                  isAppDemand: true,
                }, persistCtx, agentMessageIds);
              }

              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "pm",
                title: "需求分析",
                status: "done",
                detail: result.isAppDemand ? "识别为应用开发任务" : "识别为直接问答任务",
              });

              return {
                prd: result.prd ?? "",
                reply: result.reply ?? "",
                isAppDemand: result.isAppDemand,
              };
            })
            .addNode("directReply", async () => {
              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "direct_reply",
                title: "直接回复",
                status: "running",
                detail: "当前请求无需生成代码，进入直接答复",
              });

              const replyText = await invokeWithStream(
                llm,
                [
                  new SystemMessage(
                    "你是产品经理 Emma。由于当前用户提出的并非实际的程序开发指令，请用随和、知识面的口语化语气给出直接解答或回应。一定不能包含任何 ```json 等代码包裹或系统分析。直接像真人打字那样聊天即可。"
                  ),
                  new HumanMessage(message ?? "")
                ],
                "pm",
                "Emma",
                controller,
                encoder,
                persistCtx,
                agentMessageIds
              );

              await emitEvent(controller, encoder, {
                agent: "pm",
                name: "Emma",
                status: "done",
                content: replyText,
              }, persistCtx, agentMessageIds);

              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "direct_reply",
                title: "直接回复",
                status: "done",
              });

              return {};
            })
            .addNode("architect", async (state) => {
              const architectureToolCallId = createToolCallId("plan_architecture");
              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "architect",
                title: "架构设计",
                status: "running",
                detail: "正在规划文件结构与组件划分",
              });

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: architectureToolCallId,
                action: "tool_start",
                toolName: "plan_architecture",
                detail: "根据 PRD 生成文件结构与职责说明",
              });

              await emitEvent(controller, encoder, {
                agent: "architect",
                name: "Bob",
                status: "thinking",
                content: "正在规划组件结构与文件目录...",
              }, persistCtx, agentMessageIds);

              const archFullText = await invokeWithStream(
                llm,
                [
                  new SystemMessage(
                    "你是架构师 Bob。基于 PRD 规划组件拆分与文件目录。必须仅输出 JSON 数组格式 [{ \"path\": \"/src/xxx\", \"code\": \"简短职责描述\" }]"
                  ),
                  new HumanMessage(`PRD:\n${state.prd}\n\n请直接输出JSON数组：`),
                ],
                "architect",
                "Bob",
                controller,
                encoder,
                persistCtx,
                agentMessageIds,
                {
                  callId: architectureToolCallId,
                  toolName: "plan_architecture",
                }
              );
              let architecture: Array<{ path?: string; code?: string }>;
              try {
                architecture = parseJSONFromLLM(archFullText) as Array<{ path?: string; code?: string }>;
              } catch (error) {
                sendEvent(controller, encoder, {
                  eventType: "tool",
                  callId: architectureToolCallId,
                  action: "tool_error",
                  toolName: "plan_architecture",
                  detail: error instanceof Error ? error.message : "架构输出解析失败",
                });
                throw error;
              }

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: architectureToolCallId,
                action: "tool_result",
                toolName: "plan_architecture",
                detail: `架构输出完成，建议文件数: ${Array.isArray(architecture) ? architecture.length : 0}`,
              });

              await emitEvent(controller, encoder, {
                agent: "architect",
                name: "Bob",
                status: "done",
                content: "架构完成，交给工程师实现。",
              }, persistCtx, agentMessageIds);

              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "architect",
                title: "架构设计",
                status: "done",
              });

              return {
                architecture: JSON.stringify(architecture, null, 2),
              };
            })
            .addNode("engineer", async (state) => {
              const generateToolCallId = createToolCallId("generate_project_files");
              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "engineer",
                title: "代码生成",
                status: "running",
                detail: "工程师正在实现可运行代码",
              });

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: generateToolCallId,
                action: "tool_start",
                toolName: "generate_project_files",
                detail: "根据 PRD 与架构生成完整代码文件",
              });

              await emitEvent(controller, encoder, {
                agent: "engineer",
                name: "Alex",
                status: "thinking",
                content: "正在编写完整实现代码...",
              }, persistCtx, agentMessageIds);

              const projectFilesResult = await runFileToolLoop({
                llm,
                controller,
                encoder,
                persistCtx,
                agentMessageIds,
                agentType: "engineer",
                agentName: "Alex",
                rootToolCallId: generateToolCallId,
                rootToolName: "generate_project_files",
                initialFiles: projectFiles,
                taskInput: `用户需求:\n${state.prd}\n\n架构(JSON):\n${state.architecture}\n\n当前文件(JSON):\n${stringifyProjectFiles(projectFiles)}`,
                maxRounds: 4,
              });

              const hasFileChanges = hasMeaningfulFileChange(projectFiles, projectFilesResult);
              let fileTimestamps: Array<{ path: string; updated_at: string }> = [];

              if (hasFileChanges) {
                sendEvent(controller, encoder, {
                  eventType: "tool",
                  callId: generateToolCallId,
                  action: "tool_input_delta",
                  toolName: "generate_project_files",
                  detail: "检测到代码改动，正在同步到 Supabase",
                });

                try {
                  fileTimestamps = await persistChangedProjectFiles({
                    supabase,
                    projectId,
                    baselineFiles: projectFiles,
                    nextFiles: projectFilesResult,
                  });
                } catch (error) {
                  sendEvent(controller, encoder, {
                    eventType: "tool",
                    callId: generateToolCallId,
                    action: "tool_error",
                    toolName: "generate_project_files",
                    detail:
                      error instanceof Error ? error.message : "同步生成文件到 Supabase 失败",
                  });
                }
              }

              sendEvent(controller, encoder, {
                eventType: "tool",
                callId: generateToolCallId,
                action: "tool_result",
                toolName: "generate_project_files",
                detail: hasFileChanges
                  ? `代码生成完成，产出文件: ${Array.isArray(projectFilesResult) ? projectFilesResult.length : 0}`
                  : "代码生成流程结束，但未检测到有效代码改动",
              });

              await emitEvent(controller, encoder, {
                agent: "engineer",
                name: "Alex",
                status: "done",
                content: hasFileChanges
                  ? "代码生成完成，已准备更新沙箱。"
                  : "本轮生成未产出有效代码改动，请补充更具体需求后重试。",
                projectFiles: projectFilesResult,
                fileTimestamps,
              }, persistCtx, agentMessageIds);

              sendEvent(controller, encoder, {
                eventType: "step",
                stepId: "engineer",
                title: "代码生成",
                status: "done",
              });

              return {
                projectFiles: projectFilesResult,
              };
            })
            .addEdge(START, "pm")
            .addConditionalEdges("pm", (state) =>
              state.isAppDemand ? "architect" : "directReply"
            )
            .addEdge("architect", "engineer")
            .addEdge("engineer", END)
            .addEdge("directReply", END)
            .compile();

          await graph.invoke({
            prd: "",
            architecture: "",
            projectFiles: [],
            isAppDemand: false,
            reply: "",
          });

          controller.close();
        } catch (streamError) {
          console.error("====== AGENT STREAM ERROR ======");
          console.error(streamError);
          sendEvent(controller, encoder, {
            eventType: "tool",
            callId: createToolCallId("generate_project_files"),
            action: "tool_error",
            toolName: "generate_project_files",
            detail: streamError instanceof Error ? streamError.message : "未知错误",
          });
          sendEvent(controller, encoder, {
            eventType: "step",
            stepId: "engineer",
            title: "代码生成",
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

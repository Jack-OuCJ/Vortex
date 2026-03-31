import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

export const runtime = "nodejs";

type ProjectFile = {
  path: string;
  code: string;
};

type AgentEvent = {
  agent: "pm" | "architect" | "engineer" | "debug";
  name: string;
  status: "thinking" | "done" | "error" | "streaming";
  content?: string;
  projectFiles?: ProjectFile[];
  isAppDemand?: boolean;
};

const ProjectFileSchema = z.object({
  path: z.string(),
  code: z.string(),
});

const ProjectFilesSchema = z.array(ProjectFileSchema);

const parseJSONFromLLM = (content: string) => {
  try {
    const text = content.trim();
    const startObj = text.indexOf("{");
    const endObj = text.lastIndexOf("}");
    const startArr = text.indexOf("[");
    const endArr = text.lastIndexOf("]");
    
    // Determine whether it's trying to return an object or an array
    if (startArr !== -1 && endArr !== -1 && (startObj === -1 || startArr < startObj)) {
      return JSON.parse(text.substring(startArr, endArr + 1));
    }
    if (startObj !== -1 && endObj !== -1) {
      return JSON.parse(text.substring(startObj, endObj + 1));
    }
    throw new Error("No JSON structure found");
  } catch (e) {
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

const sendEvent = (
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: AgentEvent
) => {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
  );
};

const invokeWithStream = async (
  llm: any,
  messages: any[],
  agentType: "pm" | "architect" | "engineer" | "debug",
  agentName: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) => {
  const stream = await llm.stream(messages);
  let fullContent = "";
  for await (const chunk of stream) {
    const textChunk = (chunk.content as string) || "";
    if (!textChunk) continue;
    fullContent += textChunk;
    
    sendEvent(controller, encoder, {
      agent: agentType,
      name: agentName,
      status: "streaming",
      content: cleanThinkTags(fullContent),
    });
  }
  return cleanThinkTags(fullContent);
};

export async function POST(req: Request) {
  try {
    const { message, errorMessage, projectFiles } = await req.json();

    if (!message && !errorMessage) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const llm = createModel();

          if (errorMessage) {
            sendEvent(controller, encoder, {
              agent: "debug",
              name: "Alex",
              status: "thinking",
              content: "正在定位沙箱错误并生成修复方案...",
            });

            const debugFullText = await invokeWithStream(
              llm,
              [
                new SystemMessage(
                  "你是资深前端工程师 Alex。你收到当前项目文件与错误信息，需要直接修复代码。返回修复后的完整文件数组 JSON，格式为 [{path, code}]，不要输出多余说明。"
                ),
                new HumanMessage(
                  `错误信息:\n${errorMessage}\n\n当前文件(JSON):\n${JSON.stringify(
                    projectFiles ?? [],
                    null,
                    2
                  )}`
                ),
              ],
              "debug",
              "Alex",
              controller,
              encoder
            );
            const debugFiles = parseJSONFromLLM(debugFullText);

            sendEvent(controller, encoder, {
              agent: "debug",
              name: "Alex",
              status: "done",
              content: "修复完成，正在更新沙箱。",
              projectFiles: debugFiles,
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

          const pmSchema = z.object({
            isAppDemand: z.boolean(),
            prd: z.string().optional().default(""),
            reply: z.string().optional().default(""),
          });

          const graph = new StateGraph(stateSchema)
            .addNode("pm", async (state) => {
              sendEvent(controller, encoder, {
                agent: "pm",
                name: "Emma",
                status: "thinking",
                content: "我正在初判你的需求...",
              });

              const pmObj = await llm.invoke([
                new SystemMessage(
                  "分析用户的后续任务。如果对方要求建立或修改前端网页/应用，将其整理成一段简要 PRD。如果是任何其它纯文字闲聊或知识提问，不用整理。仅可输出严格的 JSON 格式:\n{ \"isAppDemand\": boolean, \"prd\": \"string\" }"
                ),
                new HumanMessage(`用户输入:\n${message}`)
              ]);
              const result = parseJSONFromLLM(pmObj.content as string);

              if (result.isAppDemand) {
                sendEvent(controller, encoder, {
                  agent: "pm",
                  name: "Emma",
                  status: "done",
                  content: "已确认需求场景，正在启动应用架构设计...",
                  isAppDemand: true,
                });
              }

              return {
                prd: result.prd ?? "",
                reply: result.reply ?? "",
                isAppDemand: result.isAppDemand,
              };
            })
            .addNode("directReply", async (state) => {
              const replyText = await invokeWithStream(
                llm,
                [
                  new SystemMessage(
                    "你是产品经理 Emma。由于当前用户提出的并非实际的程序开发指令，请用随和、知识面的口语化语气给出直接解答或回应。一定不能包含任何 ```json 等代码包裹或系统分析。直接像真人打字那样聊天即可。"
                  ),
                  new HumanMessage(message)
                ],
                "pm",
                "Emma",
                controller,
                encoder
              );

              sendEvent(controller, encoder, {
                agent: "pm",
                name: "Emma",
                status: "done",
                content: replyText,
              });

              return {};
            })
            .addNode("architect", async (state) => {
              sendEvent(controller, encoder, {
                agent: "architect",
                name: "Bob",
                status: "thinking",
                content: "正在规划组件结构与文件目录...",
              });

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
                encoder
              );
              const architecture = parseJSONFromLLM(archFullText);

              sendEvent(controller, encoder, {
                agent: "architect",
                name: "Bob",
                status: "done",
                content: "架构完成，交给工程师实现。",
              });

              return {
                architecture: JSON.stringify(architecture, null, 2),
              };
            })
            .addNode("engineer", async (state) => {
              sendEvent(controller, encoder, {
                agent: "engineer",
                name: "Alex",
                status: "thinking",
                content: "正在编写完整实现代码...",
              });

              const engFullText = await invokeWithStream(
                llm,
                [
                  new SystemMessage(
                    "你是工程师 Alex。根据 PRD 与架构输出完整可运行的 React + Tailwind 代码。必须使用完整 Tailwind 类名，避免空标签，并引入 lucide-react 作为图标库。必须仅输出 JSON 数组格式 [{ \"path\": \"/App.tsx\", \"code\": \"完整代码内容\" }]"
                  ),
                  new HumanMessage(
                    `PRD:\n${state.prd}\n\n架构(JSON):\n${state.architecture}\n\n请直接输出JSON数组：`
                  ),
                ],
                "engineer",
                "Alex",
                controller,
                encoder
              );
              const projectFilesResult = parseJSONFromLLM(engFullText);

              sendEvent(controller, encoder, {
                agent: "engineer",
                name: "Alex",
                status: "done",
                content: "代码生成完成，已准备更新沙箱。",
                projectFiles: projectFilesResult,
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
  } catch (error) {
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

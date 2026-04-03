import { NextResponse } from "next/server";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createClient } from "@/lib/supabase/server";
import { normalizeGeneratedProjectName } from "@/lib/project-name";

export const runtime = "nodejs";

const createProjectTitleSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
});

const createModel = () => {
  return new ChatOpenAI({
    model: "MiniMax-M2.7",
    temperature: 0.4,
    apiKey: process.env.OPENAI_API_KEY,
    configuration: process.env.OPENAI_BASE_URL
      ? { baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
  });
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createProjectTitleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const llm = createModel();
    const response = await llm.invoke([
      new SystemMessage(
        [
          "你是资深产品命名助手。",
          "请根据用户想做的项目需求，生成一个像人工认真起过的中文正式项目标题。",
          "要求：",
          "1. 只返回标题本身，不要解释，不要引号，不要 Markdown。",
          "2. 标题要自然、具体、可直接作为项目名。",
          "3. 尽量控制在 4 到 16 个中文字符内。",
          "4. 避免空泛词，比如‘新项目’‘我的应用’‘工具平台’。",
          "5. 如果需求明显是游戏、工具、SaaS、网站，请在标题里体现核心对象。",
          "6. 严禁输出任何思考过程、解释、前缀标签或推理标记，例如 <think>、analysis、reasoning。",
        ].join("\n")
      ),
      new HumanMessage(parsed.data.prompt),
    ]);

    const rawTitle = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    return NextResponse.json({
      projectName: normalizeGeneratedProjectName(rawTitle, parsed.data.prompt),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate project title",
      },
      { status: 500 }
    );
  }
}
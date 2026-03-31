import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 .env.local
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

async function testLLM() {
  console.log("=== Testing LLM Configuration ===");
  console.log("API Key Prefix:", process.env.OPENAI_API_KEY?.substring(0, 8) + "...");
  console.log("Model:", process.env.OPENAI_MODEL ?? "gpt-4o-mini (default fallback)");
  console.log("Base URL:", process.env.OPENAI_BASE_URL || "None (Defaults to api.openai.com)");

  try {
    const llm = new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : undefined,
    });
    
    console.log("Invoking LLM '你好，请简短地回复我。'...");
    const response = await llm.invoke("你好，请简短地回复我。");
    console.log("\n✅ Response Received:");
    console.log(response.content);
  } catch (err: any) {
    console.error("\n❌ LLM Invocation Error:");
    console.error(err.message);
  }
}

testLLM();

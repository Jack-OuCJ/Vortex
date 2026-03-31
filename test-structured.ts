import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env.local") });

async function testStructuredOutput() {
  console.log("=== Testing Structured Output ===");
  try {
    const llm = new ChatOpenAI({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : undefined,
    });

    const schema = z.object({
      isAppDemand: z.boolean(),
      prd: z.string().optional().default(""),
      reply: z.string().optional().default(""),
    });

    const pmModel = llm.withStructuredOutput(schema);

    console.log("Invoking PM Model with Structured Output...");
    const result = await pmModel.invoke("你好");
    console.log("\n✅ Result:", result);

  } catch (err: any) {
    console.error("\n❌ Error invoking structured output:");
    console.error(err);
    if (err.response) {
      console.error(err.response.data);
    }
  }
}

testStructuredOutput();

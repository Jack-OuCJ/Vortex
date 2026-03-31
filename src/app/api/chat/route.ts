import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    // Create a generic stream for Server-Sent Events (SSE) or a simple text stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Mock Step 1: Product Manager Emma
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              agent: "pm",
              name: "Emma",
              status: "thinking",
              content: "Let me analyze your request...",
            }) + "\n"
          )
        );

        await new Promise((resolve) => setTimeout(resolve, 1500));

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              agent: "pm",
              name: "Emma",
              status: "done",
              content: `I have converted your request "${message}" into a clear PRD. Handing over to the architect.`,
            }) + "\n"
          )
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Mock Step 2: Architect Bob
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              agent: "architect",
              name: "Bob",
              status: "done",
              content: "I have designed the React component structure based on Emma's PRD.",
            }) + "\n"
          )
        );

        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Mock Step 3: Engineer Alex
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              agent: "engineer",
              name: "Alex",
              status: "coding",
              content: "Writing the implementation...",
            }) + "\n"
          )
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Final Output with mock Code (JSONB VFS style mentioned in AGENTS.md)
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              agent: "engineer",
              name: "Alex",
              status: "done",
              content: "I've completed the code! The sandbox should now update.",
              vfs: {
                "/App.tsx": `export default function App() {\n  return (\n    <div className="p-8 font-sans">\n      <h1 className="text-2xl font-bold text-blue-500">App Generated Successfully!</h1>\n      <p>This is the newly generated code by Alex.</p>\n    </div>\n  );\n}`,
              },
            }) + "\n"
          )
        );

        controller.close();
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

import { NextResponse } from "next/server";
import { resolveWebContainerBridgeRequest } from "@/lib/webcontainer-bridge";

type RequestBody = {
  requestId?: string;
  result?: {
    ok?: boolean;
    error?: string;
    detail?: string;
    data?: unknown;
  };
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.requestId !== "string" || !body.requestId.trim()) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const result = body.result;
  if (!result || typeof result.ok !== "boolean") {
    return NextResponse.json({ error: "Missing result payload" }, { status: 400 });
  }

  const resolved = resolveWebContainerBridgeRequest(body.requestId, result.ok
    ? {
        ok: true,
        detail: typeof result.detail === "string" ? result.detail : undefined,
        data: result.data,
      }
    : {
        ok: false,
        error: typeof result.error === "string" ? result.error : "Unknown bridge error",
        detail: typeof result.detail === "string" ? result.detail : undefined,
      });

  if (!resolved) {
    return NextResponse.json({ error: "Bridge request not found or already resolved" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
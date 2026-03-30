import { NextResponse } from "next/server";

type TurnstileVerifyPayload = {
  success?: boolean;
  "error-codes"?: string[];
};

export async function POST(request: Request) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    return NextResponse.json(
      {
        success: false,
        error: "TURNSTILE_SECRET_KEY not configured",
      },
      { status: 500 },
    );
  }

  let token = "";

  try {
    const body = (await request.json()) as { token?: string };
    token = body.token?.trim() ?? "";
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid JSON body",
      },
      { status: 400 },
    );
  }

  if (!token) {
    return NextResponse.json(
      {
        success: false,
        error: "token is required",
      },
      { status: 400 },
    );
  }

  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);

  const remoteIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteIp) {
    formData.append("remoteip", remoteIp);
  }

  const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
    cache: "no-store",
  });

  if (!verifyResponse.ok) {
    return NextResponse.json(
      {
        success: false,
        error: "Turnstile verification service failed",
      },
      { status: 502 },
    );
  }

  const verifyPayload = (await verifyResponse.json()) as TurnstileVerifyPayload;

  return NextResponse.json(
    {
      success: Boolean(verifyPayload.success),
      errors: verifyPayload["error-codes"] ?? [],
    },
    { status: verifyPayload.success ? 200 : 400 },
  );
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const updateShareSchema = z.object({
  isPublic: z.boolean(),
});

const buildShareUrl = (projectId: string, token: string) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const base = appUrl && appUrl.length ? appUrl : "http://localhost:3000";
  return `${base}/preview/${projectId}?token=${encodeURIComponent(token)}`;
};

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id, is_public, share_token")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    isPublic: data.is_public,
    shareToken: data.share_token,
    shareUrl: buildShareUrl(data.id, data.share_token),
  });
}

export async function PATCH(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateShareSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .update({ is_public: parsed.data.isPublic })
    .eq("id", id)
    .select("id, is_public, share_token")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    isPublic: data.is_public,
    shareToken: data.share_token,
    shareUrl: buildShareUrl(data.id, data.share_token),
  });
}

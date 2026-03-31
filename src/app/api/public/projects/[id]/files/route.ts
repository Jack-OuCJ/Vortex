import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, is_public, share_token")
    .eq("id", id)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.is_public || project.share_token !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: files, error: filesError } = await supabase
    .from("project_files")
    .select("path, content, updated_at")
    .eq("project_id", id)
    .order("path", { ascending: true });

  if (filesError) {
    return NextResponse.json({ error: filesError.message }, { status: 500 });
  }

  return NextResponse.json({ files: files ?? [] });
}

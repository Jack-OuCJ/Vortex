import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const fileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  content: z.string(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const deletedFileSchema = z.object({
  path: z.string().trim().min(1).max(500),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

const syncFilesSchema = z
  .object({
    files: z.array(fileSchema).max(200).default([]),
    deletedFiles: z.array(deletedFileSchema).max(200).default([]),
  })
  .refine((payload) => payload.files.length > 0 || payload.deletedFiles.length > 0, {
    message: "At least one file operation is required",
  });

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AccessResult =
  | { error: NextResponse; supabase: null }
  | { error: null; supabase: Awaited<ReturnType<typeof createClient>> };

const touchProjectActivity = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
) => {
  const { error } = await supabase
    .from("projects")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) {
    console.error("Failed to touch project activity", projectId, error.message);
  }
};

const ensureProjectAccess = async (projectId: string): Promise<AccessResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), supabase: null };
  }

  const { data: project, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }), supabase: null };
  }

  if (!project) {
    return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }), supabase: null };
  }

  return { error: null, supabase };
};

export async function GET(_req: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await ensureProjectAccess(id);

  if (access.error) {
    return access.error;
  }

  const { data, error } = await access.supabase
    .from("project_files")
    .select("path, content, updated_at")
    .eq("project_id", id)
    .order("path", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ files: data ?? [] });
}

export async function PUT(req: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await ensureProjectAccess(id);

  if (access.error) {
    return access.error;
  }

  const body = await req.json().catch(() => null);
  const parsed = syncFilesSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const requestedFiles = parsed.data.files;
  const deletedFiles = parsed.data.deletedFiles;
  const requestedPaths = Array.from(
    new Set([
      ...requestedFiles.map((file) => file.path),
      ...deletedFiles.map((file) => file.path),
    ])
  );

  const { data: existingRows, error: existingError } = requestedPaths.length
    ? await access.supabase
        .from("project_files")
        .select("path, updated_at, content")
        .eq("project_id", id)
        .in("path", requestedPaths)
    : { data: [], error: null };

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingByPath = new Map<string, { updatedAt: string; content: string }>();
  (existingRows ?? []).forEach((row) => {
    if (
      typeof row.path === "string" &&
      typeof row.updated_at === "string" &&
      typeof row.content === "string"
    ) {
      existingByPath.set(row.path, {
        updatedAt: row.updated_at,
        content: row.content,
      });
    }
  });

  const conflicts: Array<{
    path: string;
    expectedUpdatedAt: string | null;
    serverUpdatedAt: string;
    serverContent: string;
  }> = [];
  const rowsToUpsert = requestedFiles
    .filter((file) => {
      const serverSnapshot = existingByPath.get(file.path);
      const expectedUpdatedAt = file.expectedUpdatedAt ?? null;

      if (
        serverSnapshot &&
        expectedUpdatedAt &&
        serverSnapshot.updatedAt !== expectedUpdatedAt
      ) {
        conflicts.push({
          path: file.path,
          expectedUpdatedAt,
          serverUpdatedAt: serverSnapshot.updatedAt,
          serverContent: serverSnapshot.content,
        });
        return false;
      }

      return true;
    })
    .map((file) => ({
      project_id: id,
      path: file.path,
      content: file.content,
    }));

  const deletedPaths = deletedFiles
    .filter((file) => {
      const serverSnapshot = existingByPath.get(file.path);
      const expectedUpdatedAt = file.expectedUpdatedAt ?? null;

      if (!serverSnapshot) {
        return false;
      }

      if (
        expectedUpdatedAt &&
        serverSnapshot.updatedAt !== expectedUpdatedAt
      ) {
        conflicts.push({
          path: file.path,
          expectedUpdatedAt,
          serverUpdatedAt: serverSnapshot.updatedAt,
          serverContent: serverSnapshot.content,
        });
        return false;
      }

      return true;
    })
    .map((file) => file.path);

  if (rowsToUpsert.length) {
    const { error } = await access.supabase
      .from("project_files")
      .upsert(rowsToUpsert, { onConflict: "project_id,path" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (deletedPaths.length) {
    const { error } = await access.supabase
      .from("project_files")
      .delete()
      .eq("project_id", id)
      .in("path", deletedPaths);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (rowsToUpsert.length || deletedPaths.length) {
    await touchProjectActivity(access.supabase, id);
  }

  const updatedPaths = rowsToUpsert.map((row) => row.path);
  let updatedRows: Array<{ path: string; updated_at: string }> = [];
  if (updatedPaths.length) {
    const { data, error } = await access.supabase
      .from("project_files")
      .select("path, updated_at")
      .eq("project_id", id)
      .in("path", updatedPaths);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    updatedRows = (data ?? []).filter(
      (row): row is { path: string; updated_at: string } =>
        typeof row.path === "string" && typeof row.updated_at === "string"
    );
  }

  const payload = {
    ok: true,
    updated: rowsToUpsert.length,
    fileTimestamps: updatedRows,
    deletedPaths,
    conflicts,
  };

  if (conflicts.length > 0) {
    return NextResponse.json(payload, { status: 409 });
  }

  return NextResponse.json(payload);
}

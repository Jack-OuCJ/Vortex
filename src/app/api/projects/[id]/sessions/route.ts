import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
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

  // Verify project belongs to user
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: sessions, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id, created_at, updated_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  if (!sessions?.length) {
    return NextResponse.json({ session: null, messages: [] });
  }

  const sessionIds = sessions
    .map((session) => session.id)
    .filter((sessionId): sessionId is string => typeof sessionId === "string");

  if (!sessionIds.length) {
    return NextResponse.json({ session: null, messages: [] });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("chat_messages")
    .select("id, session_id, role, agent_name, agent_role, content, status, created_at, steps")
    .in("session_id", sessionIds)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  const latestMessageAtBySession = new Map<string, string>();
  const messageCountBySession = new Map<string, number>();

  (messages ?? []).forEach((message) => {
    if (typeof message.session_id !== "string" || typeof message.created_at !== "string") {
      return;
    }

    messageCountBySession.set(
      message.session_id,
      (messageCountBySession.get(message.session_id) ?? 0) + 1
    );

    const previousCreatedAt = latestMessageAtBySession.get(message.session_id);
    if (!previousCreatedAt || previousCreatedAt < message.created_at) {
      latestMessageAtBySession.set(message.session_id, message.created_at);
    }
  });

  const sessionsWithMessages = sessions.filter(
    (session) => (messageCountBySession.get(session.id) ?? 0) > 0
  );

  const candidateSessions = sessionsWithMessages.length ? sessionsWithMessages : sessions;

  const activeSession = [...candidateSessions].sort((left, right) => {
    const leftActivityAt = latestMessageAtBySession.get(left.id) ?? left.updated_at ?? left.created_at;
    const rightActivityAt = latestMessageAtBySession.get(right.id) ?? right.updated_at ?? right.created_at;

    if (leftActivityAt === rightActivityAt) {
      return right.created_at.localeCompare(left.created_at);
    }

    return rightActivityAt.localeCompare(leftActivityAt);
  })[0];

  const activeMessages = (messages ?? []).filter((message) => message.session_id === activeSession.id);

  return NextResponse.json({
    session: { id: activeSession.id, created_at: activeSession.created_at, updated_at: activeSession.updated_at },
    messages: activeMessages,
  });
}

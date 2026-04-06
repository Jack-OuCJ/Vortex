import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryCategory = "preference" | "convention" | "lesson" | "context";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  relevanceScore: number;
  createdAt: string;
}

const MAX_MEMORIES = 10;

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  preference: "偏好",
  convention: "惯例",
  lesson: "教训",
  context: "上下文",
};

/**
 * Load memories for a user+project pair, sorted by relevance_score desc, limited to MAX_MEMORIES.
 */
export async function loadMemories(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<MemoryEntry[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, category, content, relevance_score, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("relevance_score", { ascending: false })
    .limit(MAX_MEMORIES);

  if (error) {
    console.error("[memory] loadMemories error:", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    category: row.category as MemoryCategory,
    content: row.content,
    relevanceScore: row.relevance_score,
    createdAt: row.created_at,
  }));
}

/**
 * Save a new memory, or increment relevance_score if duplicate content exists.
 */
export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  entry: { category: MemoryCategory; content: string },
): Promise<void> {
  // First try to find existing memory with same content
  const { data: existing, error: findError } = await supabase
    .from("memories")
    .select("id, relevance_score")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("content", entry.content)
    .maybeSingle();

  if (findError) {
    console.error("[memory] saveMemory find error:", findError.message);
    return;
  }

  if (existing) {
    // Increment relevance_score
    const { error: updateError } = await supabase
      .from("memories")
      .update({
        relevance_score: existing.relevance_score + 1,
        category: entry.category,
      })
      .eq("id", existing.id);

    if (updateError) {
      console.error("[memory] saveMemory update error:", updateError.message);
    }
  } else {
    // Insert new memory
    const { error: insertError } = await supabase.from("memories").insert({
      user_id: userId,
      project_id: projectId,
      category: entry.category,
      content: entry.content,
      relevance_score: 1,
    });

    if (insertError) {
      console.error("[memory] saveMemory insert error:", insertError.message);
    }
  }
}

/**
 * Batch save memories (called after task completion with LLM-extracted memories).
 */
export async function saveMemoriesBatch(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  entries: { category: MemoryCategory; content: string }[],
): Promise<void> {
  for (const entry of entries) {
    await saveMemory(supabase, userId, projectId, entry);
  }
}

/**
 * Format memories as a prompt block for injection into the AI system prompt.
 * Returns an empty string if no memories.
 */
export function formatMemoriesPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) {
    return "";
  }

  const lines = memories.map(
    (m) => `- [${CATEGORY_LABELS[m.category]}] ${m.content}`,
  );

  return `[记忆]\n${lines.join("\n")}\n[/记忆]`;
}

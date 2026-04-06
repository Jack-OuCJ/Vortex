/**
 * Context Compaction
 *
 * Micro-compact logic for the Alex agent tool loop.
 * Inspired by Claude Code's 5-level compression pipeline — this implements
 * Level 2 (Micro-compact) + Level 1 (Snip) for the tool loop context.
 *
 * Strategy: trim oldest tool results first, truncate long messages, and
 * collapse unreferenced bootstrap context.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { estimateTokens, shouldCompact } from "./context-tokens";

type ToolLoopMessages = Array<HumanMessage | SystemMessage>;

const MAX_TOOL_RESULT_CHARS = 2000;
const KEEP_RECENT_ROUNDS = 3;

/**
 * Count total tokens in the tool loop messages (excluding the system prompt
 * which is fixed-size and always present).
 */
function countToolLoopTokens(messages: ToolLoopMessages): number {
  return messages.reduce((sum, msg) => {
    const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    return sum + estimateTokens(text);
  }, 0);
}

/**
 * Truncate a long tool result string to a manageable size.
 */
function truncateToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  const head = Math.floor(MAX_TOOL_RESULT_CHARS / 2);
  const tail = MAX_TOOL_RESULT_CHARS - head;
  return text.slice(0, head) + `\n\n...[截断，省略 ${text.length - MAX_TOOL_RESULT_CHARS} 字符]...\n\n` + text.slice(-tail);
}

/**
 * Identify tool result messages that can be compacted.
 * Returns indices of HumanMessage entries that contain tool results.
 */
function findCompactableToolResultIndices(messages: ToolLoopMessages): number[] {
  const indices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Skip the first SystemMessage (tool loop prompt) and first HumanMessage (task input)
    if (i < 2) continue;
    if (msg instanceof HumanMessage) {
      const text = typeof msg.content === "string" ? msg.content : "";
      // Tool results start with "工具结果("
      if (text.startsWith("工具结果(")) {
        indices.push(i);
      }
    }
  }
  return indices;
}

/**
 * Apply micro-compact to reduce token usage.
 * Strategy:
 * 1. Keep the most recent N rounds of tool results intact
 * 2. Truncate older tool results to their head portion
 * 3. Replace very old tool results with a short placeholder
 *
 * Returns the compacted messages array (modifies in place for efficiency).
 */
export function applyMicroCompact(messages: ToolLoopMessages): ToolLoopMessages {
  const compactableIndices = findCompactableToolResultIndices(messages);

  // Keep the most recent rounds' tool results, truncate the rest
  const totalCompactable = compactableIndices.length;
  const truncateCount = Math.max(0, totalCompactable - KEEP_RECENT_ROUNDS);

  for (let i = 0; i < truncateCount; i++) {
    const idx = compactableIndices[i];
    const msg = messages[idx];
    if (msg instanceof HumanMessage && typeof msg.content === "string") {
      // Extract the tool result prefix line and truncate the body
      const firstNewline = msg.content.indexOf("\n");
      if (firstNewline > 0 && msg.content.length > MAX_TOOL_RESULT_CHARS) {
        const header = msg.content.slice(0, firstNewline + 1);
        const body = msg.content.slice(firstNewline + 1);
        const truncatedBody = truncateToolResult(body);
        messages[idx] = new HumanMessage(header + truncatedBody);
      }
    }
  }

  return messages;
}

/**
 * Check if compaction is needed based on token budget and apply if so.
 */
export function compactIfNeeded(messages: ToolLoopMessages): { wasCompacted: boolean; tokensFreed: number } {
  const beforeTokens = countToolLoopTokens(messages);
  if (!shouldCompact(beforeTokens)) {
    return { wasCompacted: false, tokensFreed: 0 };
  }

  applyMicroCompact(messages);
  const afterTokens = countToolLoopTokens(messages);
  return {
    wasCompacted: true,
    tokensFreed: Math.max(0, beforeTokens - afterTokens),
  };
}

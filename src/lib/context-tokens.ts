/**
 * Context Token Estimation
 *
 * Since tiktoken does not support MiniMax models, we use a character-based
 * heuristic to estimate token count. MiniMax-M2.7 has ~3.5 chars/token for
 * English and ~1.5 chars/token for mixed Chinese text.
 *
 * We use a conservative average of ~2.5 chars/token for mixed content to
 * avoid underestimating.
 */

const CHARS_PER_TOKEN = 2.5;

/**
 * Estimate token count from a string.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens from an array of strings.
 */
export function estimateTokensBatch(texts: string[]): number {
  return texts.reduce((sum, t) => sum + estimateTokens(t), 0);
}

/**
 * Budget thresholds (in tokens) for the tool loop context window.
 * MiniMax-M2.7 has 128K context window, but effective reasoning degrades
 * well before hitting the limit. We set conservative buffers.
 */
export const CONTEXT_BUDGET = {
  /** Trigger micro-compact when approaching this percentage of effective window */
  COMPACT_THRESHOLD: 150_000,
  /** Hard limit — stop adding context beyond this */
  HARD_LIMIT: 180_000,
  /** Minimum tokens to keep for tool loop messages */
  MIN_TOOL_MESSAGES_TOKENS: 15_000,
} as const;

/**
 * Check if current token usage exceeds the compact threshold.
 */
export function shouldCompact(totalTokens: number): boolean {
  return totalTokens > CONTEXT_BUDGET.COMPACT_THRESHOLD;
}

/**
 * Check if current token usage exceeds the hard limit.
 */
export function isOverBudget(totalTokens: number): boolean {
  return totalTokens > CONTEXT_BUDGET.HARD_LIMIT;
}

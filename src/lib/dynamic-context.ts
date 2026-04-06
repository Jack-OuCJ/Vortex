/**
 * Dynamic Context Selector
 *
 * Scores project files based on their relevance to the current task intent.
 * Only loads top files into context, reducing token waste.
 */

type FileIntentScore = {
  path: string;
  score: number;
  reason: string;
};

/**
 * Score a project file based on how well it matches the current intent.
 *
 * Heuristic scoring (no LLM needed, too slow for this step):
 * - Exact path match in hotFiles: 100
 * - Path contains keywords from intent: 50
 * - File is a bootstrap file (App.tsx, main.tsx, etc.): 80
 * - File is a todo.md: 90
 * - Otherwise: 0
 */
export function scoreFilesByIntent(
  fileTree: Array<{ path: string; code: string }>,
  intent: string,
  hotFiles: string[],
): FileIntentScore[] {
  // Extract keywords from intent (simple whitespace split + filter short words)
  const keywords = intent
    .toLowerCase()
    .split(/[\s,，、；;，：:（）()]+/)
    .filter((w) => w.length >= 2);

  // Bootstrap files always get high scores
  const BOOTSTRAP_SCORE: Record<string, number> = {
    "/todo.md": 90,
    "/src/App.tsx": 80,
    "/src/main.tsx": 80,
    "/src/index.css": 70,
    "/index.html": 70,
    "/package.json": 60,
    "/tsconfig.json": 50,
    "/vite.config.ts": 50,
  };

  return fileTree.map((file) => {
    let score = 0;
    const reasons: string[] = [];

    // Check if in hotFiles (recently modified or actively used)
    if (hotFiles.includes(file.path)) {
      score = Math.max(score, 100);
      reasons.push("近期活跃文件");
    }

    // Bootstrap file score
    if (BOOTSTRAP_SCORE[file.path]) {
      score = Math.max(score, BOOTSTRAP_SCORE[file.path]);
      reasons.push("项目基础文件");
    }

    // Keyword matching
    const pathLower = file.path.toLowerCase();
    const matchedKeywords = keywords.filter((kw) => pathLower.includes(kw));
    if (matchedKeywords.length > 0) {
      const keywordScore = 50 + matchedKeywords.length * 10;
      score = Math.max(score, keywordScore);
      reasons.push(`匹配关键词: ${matchedKeywords.join(", ")}`);
    }

    return { path: file.path, score, reason: reasons.join(" | ") };
  });
}

/**
 * Select the top N most relevant files from the project.
 * Always includes bootstrap files (todo.md, package.json) regardless of score.
 */
export function selectRelevantFiles(
  fileTree: Array<{ path: string; code: string }>,
  intent: string,
  hotFiles: string[],
  maxFiles: number = 30,
): Array<{ path: string; code: string }> {
  const scored = scoreFilesByIntent(fileTree, intent, hotFiles);

  // Sort by score descending, then by path length (shorter = more foundational)
  const sorted = scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.path.length - b.path.length;
  });

  // Take top N
  const selectedPaths = new Set(sorted.slice(0, maxFiles).map((s) => s.path));

  return fileTree.filter((f) => selectedPaths.has(f.path));
}

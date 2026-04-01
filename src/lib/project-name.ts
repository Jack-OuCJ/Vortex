const LEADING_PHRASE_PATTERNS = [
  /^(请|想|想要|我想|我想要|我要|帮我|请帮我|麻烦|希望|需要)\s*/u,
  /^(做一个|做个|做一款|开发一个|开发个|实现一个|实现个|创建一个|创建个|设计一个|写一个)\s*/u,
  /^(帮我做一个|帮我做个|帮我开发一个|帮我实现一个|帮我创建一个)\s*/u,
];

const TRAILING_PHRASE_PATTERNS = [
  /(吧|呀|一下|看看|出来|给我看看|试试)\s*$/u,
  /(这个|这个项目|这个应用|这个游戏)\s*$/u,
];

const WRAPPER_PATTERN = /^["'“”‘’`\s]+|["'“”‘’`\s]+$/gu;
const MAX_PROJECT_NAME_LENGTH = 16;
const REASONING_BLOCK_PATTERN = /<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/giu;
const LEADING_REASONING_TAG_PATTERN = /^<(think|analysis|reasoning)\b[^>]*>/iu;
const INVALID_TITLE_PREFIX_PATTERN = /^(think|analysis|reasoning|thought|思考|分析|推理|用户|需求|标题|项目名|命名)/iu;
const INVALID_TITLE_CONTENT_PATTERN = /(用户想|用户要|用户希望|根据用户|这个标题|项目标题|我来|我会|以下|如下|需求是)/u;
const VALID_TITLE_CHAR_PATTERN = /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9\s·:：-]*[\p{Script=Han}A-Za-z0-9]$/u;

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const stripReasoningArtifacts = (value: string) => {
  return collapseWhitespace(
    value
      .replace(REASONING_BLOCK_PATTERN, " ")
      .replace(LEADING_REASONING_TAG_PATTERN, "")
      .replace(/^```[\s\S]*?```$/gu, " ")
      .replace(/^<[^>]+>/gu, " ")
  );
};

const stripLeadingPhrases = (value: string) => {
  let next = value;
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of LEADING_PHRASE_PATTERNS) {
      const updated = next.replace(pattern, "").trim();
      if (updated !== next) {
        next = updated;
        changed = true;
      }
    }
  }

  return next;
};

const stripTrailingPhrases = (value: string) => {
  let next = value;
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of TRAILING_PHRASE_PATTERNS) {
      const updated = next.replace(pattern, "").trim();
      if (updated !== next) {
        next = updated;
        changed = true;
      }
    }
  }

  return next;
};

const trimProjectNameLength = (value: string, maxLength = MAX_PROJECT_NAME_LENGTH) => {
  const chars = Array.from(value);
  if (chars.length <= maxLength) {
    return value;
  }
  return chars.slice(0, maxLength).join("").trim();
};

const isLikelyProjectTitle = (value: string) => {
  if (value.length < 2 || value.length > MAX_PROJECT_NAME_LENGTH) {
    return false;
  }

  if (INVALID_TITLE_PREFIX_PATTERN.test(value)) {
    return false;
  }

  if (INVALID_TITLE_CONTENT_PATTERN.test(value)) {
    return false;
  }

  if (/[<>]/u.test(value)) {
    return false;
  }

  return VALID_TITLE_CHAR_PATTERN.test(value);
};

export const buildFallbackProjectName = (prompt: string) => {
  const firstClause = collapseWhitespace(prompt)
    .split(/[\n。！？!?；;，,]/u)
    .map((part) => part.trim())
    .find(Boolean) ?? "";

  const cleaned = trimProjectNameLength(
    stripTrailingPhrases(
      stripLeadingPhrases(firstClause.replace(WRAPPER_PATTERN, ""))
    )
  );

  if (cleaned.length >= 2) {
    return cleaned;
  }

  return `新项目 ${new Date().toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export const normalizeGeneratedProjectName = (rawTitle: string, prompt: string) => {
  const compact = stripReasoningArtifacts(rawTitle)
    .replace(/^[-*\d.\s]+/, "")
    .replace(WRAPPER_PATTERN, "")
    .replace(/[。！？!?]+$/u, "");

  const candidate = compact
    .split(/\r?\n/u)
    .map((line) => collapseWhitespace(line.replace(/^[-*\d.\s]+/, "").replace(WRAPPER_PATTERN, "")))
    .find((line) => isLikelyProjectTitle(trimProjectNameLength(line))) ?? "";

  const sanitized = trimProjectNameLength(candidate);

  if (sanitized.length >= 2) {
    return sanitized;
  }

  return buildFallbackProjectName(prompt);
};
export type WorkflowToolName =
  | "route_request"
  | "execute_task"
  | "wc.fs.readFile"
  | "wc.fs.writeFile"
  | "wc.fs.readdir"
  | "wc.fs.mkdir"
  | "wc.fs.rm"
  | "wc.spawn"
  | "wc.readProcess"
  | "wc.killProcess";

export type WorkflowStepStatus = "running" | "done" | "error";

export type WorkflowStepSource = "step" | "tool";

export type WorkflowStep = {
  id: string;
  title: string;
  status: WorkflowStepStatus;
  detail?: string;
  updatedAt: number;
  round?: number;
  source: WorkflowStepSource;
  toolName?: WorkflowToolName;
};

const TOOL_TITLE_MAP: Record<WorkflowToolName, string> = {
  route_request: "任务分析",
  execute_task: "任务执行",
  "wc.fs.readFile": "读取文件",
  "wc.fs.writeFile": "写入文件",
  "wc.fs.readdir": "读取目录",
  "wc.fs.mkdir": "创建目录",
  "wc.fs.rm": "删除路径",
  "wc.spawn": "执行命令",
  "wc.readProcess": "读取进程输出",
  "wc.killProcess": "终止进程",
};

const isWorkflowStatus = (value: unknown): value is WorkflowStepStatus => {
  return value === "running" || value === "done" || value === "error";
};

const isWorkflowSource = (value: unknown): value is WorkflowStepSource => {
  return value === "step" || value === "tool";
};

export const formatDisplayPath = (path: string) => {
  const normalized = path.trim();

  if (!normalized || normalized === "/") {
    return "根目录";
  }

  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
};

export const stripWorkflowPathDecorations = (value?: string) => {
  if (!value) {
    return value;
  }

  return value.replace(/\/(?:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g, (match) => formatDisplayPath(match));
};

export const formatWorkflowToolTitle = (toolName: WorkflowToolName) => {
  return TOOL_TITLE_MAP[toolName] ?? `工具: ${toolName}`;
};

export const normalizeWorkflowSteps = (input: unknown): WorkflowStep[] => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.title !== "string" || !isWorkflowStatus(record.status)) {
        return null;
      }

      const toolName = typeof record.toolName === "string" ? (record.toolName as WorkflowToolName) : undefined;

      return {
        id: record.id,
        title: record.title,
        status: record.status,
        detail: typeof record.detail === "string" ? record.detail : undefined,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : index,
        round: typeof record.round === "number" ? record.round : undefined,
        source: isWorkflowSource(record.source) ? record.source : toolName ? "tool" : "step",
        toolName,
      } as WorkflowStep;
    })
    .filter((step): step is WorkflowStep => step !== null)
    .sort((left, right) => left.updatedAt - right.updatedAt);
};
type WebContainerFsReadFileRequest = {
  path: string;
  encoding?: "utf-8";
};

type WebContainerFsWriteFileRequest = {
  path: string;
  content: string;
};

type WebContainerFsReadDirRequest = {
  path: string;
};

type WebContainerFsMkdirRequest = {
  path: string;
};

type WebContainerFsRmRequest = {
  path: string;
  recursive?: boolean;
};

type WebContainerSpawnRequest = {
  command: string;
  args?: string[];
  cwd?: string;
  waitForExit?: boolean;
};

type WebContainerReadProcessRequest = {
  procId: string;
};

type WebContainerKillProcessRequest = {
  procId: string;
};

export type WebContainerToolName =
  | "wc.fs.readFile"
  | "wc.fs.writeFile"
  | "wc.fs.readdir"
  | "wc.fs.mkdir"
  | "wc.fs.rm"
  | "wc.spawn"
  | "wc.readProcess"
  | "wc.killProcess";

export type WebContainerToolInputMap = {
  "wc.fs.readFile": WebContainerFsReadFileRequest;
  "wc.fs.writeFile": WebContainerFsWriteFileRequest;
  "wc.fs.readdir": WebContainerFsReadDirRequest;
  "wc.fs.mkdir": WebContainerFsMkdirRequest;
  "wc.fs.rm": WebContainerFsRmRequest;
  "wc.spawn": WebContainerSpawnRequest;
  "wc.readProcess": WebContainerReadProcessRequest;
  "wc.killProcess": WebContainerKillProcessRequest;
};

export type WebContainerBridgeRequest<TName extends WebContainerToolName = WebContainerToolName> = {
  requestId: string;
  toolName: TName;
  input: WebContainerToolInputMap[TName];
  createdAt: number;
};

export type WebContainerBridgeSuccessResult = {
  ok: true;
  detail?: string;
  data?: unknown;
};

export type WebContainerBridgeErrorResult = {
  ok: false;
  error: string;
  detail?: string;
};

export type WebContainerBridgeResult = WebContainerBridgeSuccessResult | WebContainerBridgeErrorResult;

type PendingBridgeRequest = {
  request: WebContainerBridgeRequest;
  resolve: (result: WebContainerBridgeResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingBridgeRequests = new Map<string, PendingBridgeRequest>();

const BRIDGE_TIMEOUT_MS = 90_000;

export const createWebContainerBridgeRequest = <TName extends WebContainerToolName>(
  toolName: TName,
  input: WebContainerToolInputMap[TName],
  timeoutMs = BRIDGE_TIMEOUT_MS
) => {
  const requestId = `${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const request: WebContainerBridgeRequest<TName> = {
    requestId,
    toolName,
    input,
    createdAt: Date.now(),
  };

  const resultPromise = new Promise<WebContainerBridgeResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeRequests.delete(requestId);
      reject(new Error(`WebContainer bridge timeout for ${toolName}`));
    }, timeoutMs);

    pendingBridgeRequests.set(requestId, {
      request,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    });
  });

  return {
    request,
    resultPromise,
  };
};

export const resolveWebContainerBridgeRequest = (
  requestId: string,
  result: WebContainerBridgeResult
) => {
  const pending = pendingBridgeRequests.get(requestId);
  if (!pending) {
    return false;
  }

  pendingBridgeRequests.delete(requestId);
  clearTimeout(pending.timer);
  pending.resolve(result);
  return true;
};

export const rejectWebContainerBridgeRequest = (requestId: string, error: Error) => {
  const pending = pendingBridgeRequests.get(requestId);
  if (!pending) {
    return false;
  }

  pendingBridgeRequests.delete(requestId);
  clearTimeout(pending.timer);
  pending.reject(error);
  return true;
};
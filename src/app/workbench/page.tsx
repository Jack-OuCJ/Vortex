"use client";

import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Atom, Check, PanelLeft, RefreshCw, Square, X } from "lucide-react";
import Lottie from "lottie-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import liveChatbotAnimation from "../../../public/anim/Live chatbot.json";
import { MonacoCodeEditor } from "@/components/MonacoCodeEditor";
import { SidebarDrawer } from "@/components/SidebarAndHeader";
import { WorkbenchFileTree } from "@/components/WorkbenchFileTree";
import { WorkflowAccordion } from "@/components/WorkflowAccordion";
import { useWebContainer } from "@/hooks/useWebContainer";
import { AGENT_AVATAR_MAP, AGENT_ROLE_LABEL_MAP } from "@/lib/agent-meta";
import { formatDisplayPath, formatWorkflowToolTitle } from "@/lib/workflow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useHistoryStore } from "@/stores/historyStore";
import type { WebContainerBridgeRequest, WebContainerBridgeResult, WebContainerToolInputMap, WebContainerToolName } from "@/lib/webcontainer-bridge";

type ProjectSummary = {
  id: string;
  name: string;
};

type ProjectFile = {
  path: string;
  content: string;
  updated_at?: string;
};

type FileSyncResponse = {
  error?: string;
  fileTimestamps?: Array<{ path: string; updated_at: string }>;
  deletedPaths?: string[];
  conflicts?: Array<{
    path: string;
    expectedUpdatedAt: string | null;
    serverUpdatedAt: string;
    serverContent: string;
  }>;
};

type AgentStreamEvent = {
  eventType?: "agent";
  agent: "engineer";
  name: string;
  status: "thinking" | "done" | "error" | "streaming";
  content?: string;
  projectFiles?: Array<{ path: string; code: string }>;
  fileTimestamps?: Array<{ path: string; updated_at: string }>;
  isFinalSnapshot?: boolean;
};

type SessionStreamEvent = {
  eventType: "session";
  sessionId: string;
};

type StepStreamEvent = {
  eventType: "step";
  stepId: "route" | "execute";
  title: string;
  status: "running" | "done" | "error";
  detail?: string;
};

type ToolStreamEvent = {
  eventType: "tool";
  callId: string;
  action: "tool_start" | "tool_input_delta" | "tool_result" | "tool_error";
  toolName:
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
  detail?: string;
};

type WebContainerRequestStreamEvent = {
  eventType: "webcontainer_request";
  request: WebContainerBridgeRequest;
};

type ProjectRenameStreamEvent = {
  eventType: "project_rename";
  name: string;
};

type StreamEvent = AgentStreamEvent | SessionStreamEvent | StepStreamEvent | ToolStreamEvent | WebContainerRequestStreamEvent | ProjectRenameStreamEvent;

const isThinkingOrStreaming = (status?: "thinking" | "done" | "error" | "streaming") =>
  status === "thinking" || status === "streaming";

const buildMergeCandidate = (localContent: string, serverContent: string, serverUpdatedAt: string) => {
  return [
    "<<<<<<< local",
    localContent,
    "=======",
    serverContent,
    `>>>>>>> remote (${serverUpdatedAt})`,
  ].join("\n");
};

const formatStepPathLabel = (path: string) => {
  return formatDisplayPath(path);
};

const getParentDirectoryPaths = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => `/${segments.slice(0, index + 1).join("/")}`);
};

function WorkbenchLoadingState() {
  return (
    <div className="h-full w-full flex items-center justify-center px-6">
      <div className="flex items-center justify-center">
        <Lottie
          animationData={liveChatbotAnimation}
          loop
          className="h-56 w-56 sm:h-72 sm:w-72"
        />
      </div>
    </div>
  );
}

export function WorkbenchContent() {
  const {
    activeTab,
    setActiveTab,
    sidebarWidth,
    setSidebarWidth,
    steps,
    expandedDirectories,
    resetSteps,
    toggleDirectory,
    expandDirectories,
    upsertStep,
  } = useUiStore();
  const {
    projectId,
    projectName,
    sessionId,
    isBootstrapping,
    files: projectFiles,
    fileTimestamps,
    conflictCandidates,
    activeFilePath,
    setProjectMeta,
    setSessionId,
    setIsBootstrapping,
    setRemoteFiles,
    upsertFiles,
    removeFiles,
    setFileTimestamps,
    upsertConflictCandidates,
    clearConflictCandidate,
    updateActiveFile,
    setActiveFilePath,
  } = useProjectStore();
  const {
    inputValue,
    setInputValue,
    messages,
    isGenerating,
    setIsGenerating,
    appendMessage,
    upsertAgentMessage,
    updateLastAgentMessage,
    loadHistory,
    resetMessages,
  } = useChatStore();
  const { patchLocalProjectName } = useHistoryStore();

  const [nowTs, setNowTs] = useState<number | null>(null);
  const [previewRefreshSeed, setPreviewRefreshSeed] = useState(0);
  const [isHomeSidebarPinned, setIsHomeSidebarPinned] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastManualEditAtRef = useRef<Record<string, number>>({});
  const dirtyFilePathsRef = useRef<Set<string>>(new Set());
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});
  const autoPromptConsumedRef = useRef(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setIsHomeSidebarPinned(window.localStorage.getItem("sidebarPinned") === "true");
  }, []);

  const loadPendingHomeAttachments = useCallback((targetProjectId: string) => {
    if (typeof window === "undefined") {
      return [] as Array<{ name: string; content: string; mimeType: string }>;
    }

    const storageKey = `pending-home-attachments:${targetProjectId}`;
    const storedValue = window.sessionStorage.getItem(storageKey);
    window.sessionStorage.removeItem(storageKey);

    if (!storedValue) {
      return [] as Array<{ name: string; content: string; mimeType: string }>;
    }

    try {
      const parsed = JSON.parse(storedValue);
      if (!Array.isArray(parsed)) {
        return [] as Array<{ name: string; content: string; mimeType: string }>;
      }

      return parsed.filter((item): item is { name: string; content: string; mimeType: string } => {
        return Boolean(
          item
            && typeof item === "object"
            && typeof item.name === "string"
            && typeof item.content === "string"
            && typeof item.mimeType === "string"
        );
      });
    } catch {
      return [] as Array<{ name: string; content: string; mimeType: string }>;
    }
  }, []);

  const {
    isReady: isContainerReady,
    serverUrl,
    syncFiles,
    writeFile,
    readFile,
    readDir,
    makeDir,
    removePath,
    spawnProcess,
    readProcess,
    killProcess,
  } = useWebContainer();

  const executeWebContainerRequest = useCallback(async (request: WebContainerBridgeRequest): Promise<WebContainerBridgeResult> => {
    try {
      switch (request.toolName as WebContainerToolName) {
        case "wc.fs.readFile": {
          const input = request.input as WebContainerToolInputMap["wc.fs.readFile"];
          const content = await readFile(input.path);
          return {
            ok: true,
            detail: `${formatStepPathLabel(input.path)} 已读取`,
            data: { path: input.path, content },
          };
        }
        case "wc.fs.writeFile": {
          const input = request.input as WebContainerToolInputMap["wc.fs.writeFile"];
          await writeFile(input.path, input.content);
          return {
            ok: true,
            detail: `${formatStepPathLabel(input.path)} 已写入`,
            data: { path: input.path, length: input.content.length },
          };
        }
        case "wc.fs.readdir": {
          const input = request.input as WebContainerToolInputMap["wc.fs.readdir"];
          const entries = await readDir(input.path);
          return {
            ok: true,
            detail: `${formatStepPathLabel(input.path)} 已列出 (${entries.length} 项)`,
            data: { path: input.path, entries },
          };
        }
        case "wc.fs.mkdir": {
          const input = request.input as WebContainerToolInputMap["wc.fs.mkdir"];
          await makeDir(input.path);
          return {
            ok: true,
            detail: `${formatStepPathLabel(input.path)} 已创建目录`,
            data: { path: input.path },
          };
        }
        case "wc.fs.rm": {
          const input = request.input as WebContainerToolInputMap["wc.fs.rm"];
          await removePath(input.path, { recursive: input.recursive === true });
          return {
            ok: true,
            detail: `${formatStepPathLabel(input.path)} 已删除`,
            data: { path: input.path, recursive: input.recursive === true },
          };
        }
        case "wc.spawn": {
          const input = request.input as WebContainerToolInputMap["wc.spawn"];
          const snapshot = await spawnProcess(input.command, input.args ?? [], {
            cwd: input.cwd,
            waitForExit: input.waitForExit === true,
          });
          return {
            ok: true,
            detail: `${input.command} ${(input.args ?? []).join(" ")}`.trim(),
            data: snapshot,
          };
        }
        case "wc.readProcess": {
          const input = request.input as WebContainerToolInputMap["wc.readProcess"];
          const snapshot = await readProcess(input.procId);
          return {
            ok: true,
            detail: `${input.procId} 输出已读取`,
            data: snapshot,
          };
        }
        case "wc.killProcess": {
          const input = request.input as WebContainerToolInputMap["wc.killProcess"];
          const killed = await killProcess(input.procId);
          return killed
            ? {
                ok: true,
                detail: `${input.procId} 已终止`,
                data: { procId: input.procId, killed: true },
              }
            : {
                ok: false,
                error: `Process not found: ${input.procId}`,
              };
        }
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "WebContainer request failed",
      };
    }

    return {
      ok: false,
      error: `Unsupported WebContainer tool: ${request.toolName}`,
    };
  }, [killProcess, makeDir, readDir, readFile, readProcess, removePath, spawnProcess, writeFile]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  useEffect(() => {
    setNowTs(Date.now());
  }, []);

  const markDirtyPaths = useCallback((paths: string[]) => {
    if (!paths.length) {
      return;
    }

    paths.forEach((path) => {
      dirtyFilePathsRef.current.add(path);
    });
  }, []);

  const syncProjectFilesToServer = useCallback(
    async (filesSnapshot: Record<string, string>, deletedPaths: string[] = []) => {
      if (!projectId) {
        console.warn("[syncProjectFilesToServer] projectId 为空，跳过同步");
        return {
          ok: false,
          error: "项目尚未初始化",
          updatedCount: 0,
          conflictCount: 0,
          updatedPaths: [] as string[],
          deletedPaths: [] as string[],
          conflictPaths: [] as string[],
        };
      }

      const files = Object.entries(filesSnapshot).map(([path, content]) => ({
        path,
        content,
        expectedUpdatedAt: fileTimestamps[path] ?? null,
      }));

      console.log("[syncProjectFilesToServer] 开始同步", { projectId, files: files.map(f => ({ path: f.path, expectedUpdatedAt: f.expectedUpdatedAt })) });

      if (!files.length && !deletedPaths.length) {
        return {
          ok: true,
          updatedCount: 0,
          conflictCount: 0,
          updatedPaths: [] as string[],
          deletedPaths: [] as string[],
          conflictPaths: [] as string[],
        };
      }

      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files,
          deletedFiles: deletedPaths.map((path) => ({
            path,
            expectedUpdatedAt: fileTimestamps[path] ?? null,
          })),
        }),
      });

      const isConflict = response.status === 409;
      let payload: FileSyncResponse | null = null;

      try {
        payload = (await response.json()) as FileSyncResponse;
      } catch {
        payload = null;
      }

      if (!response.ok && !isConflict) {
        return {
          ok: false,
          error:
            payload?.error ||
            `文件同步失败（HTTP ${response.status}）`,
          updatedCount: 0,
          conflictCount: 0,
          updatedPaths: [] as string[],
          deletedPaths: [] as string[],
          conflictPaths: [] as string[],
        };
      }

      if (!payload) {
        return {
          ok: false,
          error: "文件同步失败，服务端未返回有效结果",
          updatedCount: 0,
          conflictCount: 0,
          updatedPaths: [] as string[],
          deletedPaths: [] as string[],
          conflictPaths: [] as string[],
        };
      }

      if (Array.isArray(payload.fileTimestamps) && payload.fileTimestamps.length) {
        setFileTimestamps(payload.fileTimestamps);
      }

      if (Array.isArray(payload.conflicts) && payload.conflicts.length) {
        const candidates = payload.conflicts.map((conflict) => {
          const localContent = filesSnapshot[conflict.path] ?? "";
          return {
            path: conflict.path,
            localContent,
            serverContent: conflict.serverContent,
            mergedContent: buildMergeCandidate(
              localContent,
              conflict.serverContent,
              conflict.serverUpdatedAt
            ),
            serverUpdatedAt: conflict.serverUpdatedAt,
          };
        });

        upsertConflictCandidates(candidates);

        payload.conflicts.forEach((conflict) => {
          upsertStep({
            id: `server-conflict:${conflict.path}`,
            title: "服务端冲突拦截",
            status: "error",
            detail: `${conflict.path} 已在其他会话更新，请刷新后重试`,
          });
        });
      }

      return {
        ok: true,
        error: undefined,
        updatedCount: payload.fileTimestamps?.length ?? 0,
        conflictCount: payload.conflicts?.length ?? 0,
        updatedPaths: payload.fileTimestamps?.map((row) => row.path) ?? [],
        deletedPaths: payload.deletedPaths ?? [],
        conflictPaths: payload.conflicts?.map((conflict) => conflict.path) ?? [],
      };
    },
    [fileTimestamps, projectId, setFileTimestamps, upsertConflictCandidates, upsertStep]
  );

  const formatMessageTime = (ts?: number) => {
    if (!ts) return "";
    const date = new Date(ts);
    return `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  const formatTimeOnly = (ts?: number) => {
    if (!ts) return "";
    const date = new Date(ts);
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  const checkNeedDivider = (currentTs?: number, prevTs?: number) => {
    if (!currentTs) return false;
    if (!prevTs) return true; // 强制第一条需要显示时间分隔
    const d1 = new Date(currentTs);
    const d2 = new Date(prevTs);
    return d1.getFullYear() !== d2.getFullYear() || d1.getMonth() !== d2.getMonth() || d1.getDate() !== d2.getDate();
  };

  const formatDividerDate = (ts?: number) => {
    if (!ts) return "";
    const date = new Date(ts);
    return `${date.getMonth() + 1}月 ${date.getDate()}, ${date.getFullYear()}`;
  };

  const SCROLL_BOTTOM_THRESHOLD_PX = 96;

  const isNearBottom = (element: HTMLDivElement, threshold = SCROLL_BOTTOM_THRESHOLD_PX) => {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold;
  };

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;

    if (container) {
      shouldStickToBottomRef.current = true;
      container.scrollTo({
        top: container.scrollHeight,
        behavior,
      });
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;

    if (!container) {
      return;
    }

    shouldStickToBottomRef.current = isNearBottom(container);
  }, []);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom(messages.length <= 1 ? "auto" : "smooth");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, steps, scrollToBottom]);

  useEffect(() => {
    let mounted = true;

    const bootstrapProject = async () => {
      try {
        if (!mounted) return;

        const isNewProjectFlow = searchParams.get("newProject") === "true";
        const targetProjectId = searchParams.get("project_id");

        console.log("[bootstrap] 开始 bootstrapProject", {
          isNewProjectFlow,
          targetProjectId,
          currentProjectId: projectId,
          searchParamsKey,
        });

        if (!isNewProjectFlow && targetProjectId && projectId === targetProjectId) {
          console.log("[bootstrap] 早返回：projectId 与 targetProjectId 相同，跳过重载", targetProjectId);
          return;
        }

        setIsBootstrapping(true);
        resetMessages();
        resetSteps();
        setSessionId(null);

        // newProject=true means user came from homepage with a fresh prompt — always create a new project
        // project_id means user explicitly clicked a project to open

        let activeProject: ProjectSummary | undefined;

        if (targetProjectId) {
          // Load the specific project the user clicked
          console.log("[bootstrap] 通过 URL project_id 加载项目:", targetProjectId);
          resetMessages();
          const projectRes = await fetch(`/api/projects/${targetProjectId}`, { method: "GET" });
          if (!projectRes.ok) {
            console.error("Failed to load target project", targetProjectId, projectRes.status);
            return;
          }

          const projectJson = (await projectRes.json()) as { project?: ProjectSummary };
          activeProject = projectJson.project;
          console.log("[bootstrap] 项目详情加载结果:", activeProject ? "成功" : "payload 中无 project 字段");

          if (!activeProject) {
            console.error("Target project payload missing project", targetProjectId);
            return;
          }
        } else if (!isNewProjectFlow) {
          console.log("[bootstrap] 无 project_id，加载项目列表取第一个");
          const listRes = await fetch("/api/projects", { method: "GET" });
          if (!listRes.ok) {
            console.error("[bootstrap] 项目列表加载失败", listRes.status);
            return;
          }

          const listJson = (await listRes.json()) as { projects?: ProjectSummary[] };
          activeProject = listJson.projects?.[0];
          console.log("[bootstrap] 项目列表第一个:", activeProject?.id ?? "无项目");
        }

        if (!activeProject) {
          const createRes = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `新项目 ${new Date().toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` }),
          });

          if (!createRes.ok) {
            return;
          }

          const createJson = (await createRes.json()) as { project?: ProjectSummary };
          activeProject = createJson.project;
        }

        if (!activeProject || !mounted) return;

        console.log("[bootstrap] 活跃项目已确定，开始加载文件和会话", { projectId: activeProject.id, projectName: activeProject.name });
        // 注意：setProjectMeta 被移到所有异步加载完成后再调用。
        // 原因：setProjectMeta 会更新 projectId (store)，而 projectId 是本 useEffect 的依赖，
        // 这会导致 effect 在 async 期间触发清理（mounted = false），使后续 loadHistory / setRemoteFiles 被跳过。

        const [filesRes, sessionsRes] = await Promise.all([
          fetch(`/api/projects/${activeProject.id}/files`, { method: "GET" }),
          fetch(`/api/projects/${activeProject.id}/sessions`, { method: "GET" }),
        ]);

        console.log("[bootstrap] files 响应状态:", filesRes.status, "sessions 响应状态:", sessionsRes.status);

        if (!filesRes.ok) {
          console.error("[bootstrap] 文件加载失败", filesRes.status, await filesRes.text());
          return;
        }

        const filesJson = (await filesRes.json()) as { files?: ProjectFile[] };
        console.log("[bootstrap] 文件加载完成，文件数:", filesJson.files?.length ?? 0);
        if (!mounted) return;
        setRemoteFiles(filesJson.files ?? []);

        if (sessionsRes.ok) {
          const sessionsJson = (await sessionsRes.json()) as {
            session?: { id: string } | null;
            messages?: Array<{
              role: "user" | "agent";
              agent_name: string | null;
              agent_role: string | null;
              content: string;
              status: "thinking" | "streaming" | "done" | "stopped" | "error";
              created_at: string;
              steps?: unknown;
            }>;
          };
          console.log("[bootstrap] 会话加载完成", { sessionId: sessionsJson.session?.id, messagesCount: sessionsJson.messages?.length ?? 0 });
          if (!mounted) return;
          setSessionId(sessionsJson.session?.id ?? null);
          loadHistory(sessionsJson.messages ?? []);
        } else {
          console.error("[bootstrap] 会话加载失败", sessionsRes.status, await sessionsRes.text());
        }

        // 所有异步加载完成后才设置 projectId，避免提前触发 useEffect 清理导致 mounted=false
        if (mounted) {
          console.log("[bootstrap] 所有数据加载完成，设置 projectMeta", { id: activeProject.id, name: activeProject.name });
          setProjectMeta(activeProject.id, activeProject.name);
        }
      } catch (error) {
        console.error("Failed to bootstrap project", error);
      } finally {
        if (mounted) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrapProject();

    return () => {
      mounted = false;
    };
  }, [
    loadHistory,
    resetMessages,
    resetSteps,
    searchParams,
    searchParamsKey,
    projectId,
    setIsBootstrapping,
    setProjectMeta,
    setRemoteFiles,
    setSessionId,
  ]);

  useEffect(() => {
    if (!projectId || isBootstrapping) {
      return;
    }
  }, [
    isBootstrapping,
    projectId,
  ]);

  useEffect(() => {
    if (!isContainerReady || isBootstrapping) {
      return;
    }

    void syncFiles(projectFiles);
  }, [isBootstrapping, isContainerReady, projectFiles, syncFiles]);

  const sendMessage = useCallback(async (
    rawMessage: string,
    options?: {
      isNewProject?: boolean;
      clearInput?: boolean;
      attachmentsOverride?: Array<{ name: string; content: string; mimeType: string }>;
    }
  ) => {
    const userMsg = rawMessage.trim();
    if (!userMsg || isGenerating) return;

    const now = Date.now();

    appendMessage({
      agent: "user",
      name: "You",
      avatar: "/teams-avatar/Leader.png",
      content: userMsg,
      timestamp: Date.now(),
    });
    resetSteps();
    if (options?.clearInput !== false) {
      setInputValue("");
    }
    
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      const recentEditedPaths = Object.entries(lastManualEditAtRef.current)
        .filter(([, timestamp]) => now - timestamp < 10 * 60 * 1000)
        .sort((a, b) => b[1] - a[1])
        .map(([path]) => path);

      const hotFilePaths = Array.from(
        new Set([
          activeFilePath,
          ...Object.keys(pendingEdits),
          ...Array.from(dirtyFilePathsRef.current),
          ...recentEditedPaths,
        ].filter((path): path is string => Boolean(path && typeof displayFiles[path] === "string")))
      ).slice(0, 6);

      const hotFiles = hotFilePaths.map((path) => ({
        // pendingEdits 包含草稿内容，优先用草稿传给 AI
        path,
        code: displayFiles[path],
      }));

      const fileTree = Object.entries(projectFiles)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, code]) => {
          const lastEditedAt = lastManualEditAtRef.current[path] ?? 0;
          return {
            path,
            size: code.length,
            isActive: path === activeFilePath,
            isDirty: (path in pendingEdits) || dirtyFilePathsRef.current.has(path),
            isRecentlyEdited: lastEditedAt > 0 && now - lastEditedAt < 10 * 60 * 1000,
          };
        });

      const currentAttachments = options?.attachmentsOverride ?? [];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          hotFiles,
          fileTree,
          projectId,
          sessionId,
          isNewProject: options?.isNewProject === true,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.body) return;
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let sseBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as StreamEvent;

              if (data.eventType === "session") {
                setSessionId(data.sessionId);
                continue;
              }

              if (data.eventType === "step") {
                upsertStep({
                  id: data.stepId,
                  title: data.title,
                  status: data.status,
                  detail: data.detail,
                  source: "step",
                });
                continue;
              }

              if (data.eventType === "tool") {
                const stepId = `tool:${data.callId}`;
                const title = formatWorkflowToolTitle(data.toolName);

                if (data.action === "tool_start" || data.action === "tool_input_delta") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "running",
                    detail: data.detail,
                    source: "tool",
                    toolName: data.toolName,
                  });
                }

                if (data.action === "tool_result") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "done",
                    detail: data.detail,
                    source: "tool",
                    toolName: data.toolName,
                  });
                }

                if (data.action === "tool_error") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "error",
                    detail: data.detail,
                    source: "tool",
                    toolName: data.toolName,
                  });
                }

                continue;
              }

              if (data.eventType === "webcontainer_request") {
                void executeWebContainerRequest(data.request)
                  .then(async (result) => {
                    const response = await fetch("/api/webcontainer-bridge", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        requestId: data.request.requestId,
                        result,
                      }),
                    });

                    if (!response.ok) {
                      throw new Error(`Bridge callback failed with status ${response.status}`);
                    }
                  })
                  .catch((error) => {
                    console.error("Failed to deliver WebContainer bridge result", {
                      requestId: data.request.requestId,
                      toolName: data.request.toolName,
                      error,
                    });
                  });

                continue;
              }

              if (data.eventType === "project_rename") {
                if (projectId) {
                  setProjectMeta(projectId, data.name);
                  patchLocalProjectName(projectId, data.name);
                }
                continue;
              }

              const agentData = data as AgentStreamEvent;

              const avatar = AGENT_AVATAR_MAP[agentData.agent] || AGENT_AVATAR_MAP.engineer;

              upsertAgentMessage({
                agent: agentData.agent,
                name: agentData.name,
                avatar,
                content: agentData.content || "",
                status: agentData.status,
                timestamp: Date.now(),
              });

              const generatedFiles = agentData.projectFiles;
              if (generatedFiles && Array.isArray(generatedFiles)) {
                const now = Date.now();
                const isFinalEngineerSnapshot = agentData.isFinalSnapshot === true;
                const safeFiles = generatedFiles.filter((f) => {
                  const lastEditAt = lastManualEditAtRef.current[f.path] ?? 0;
                  const isRecentlyEdited = now - lastEditAt < 1500;

                  if (isRecentlyEdited) {
                    upsertStep({
                      id: `conflict:${f.path}`,
                      title: "文件冲突保护",
                      status: "running",
                      detail: `${f.path} 最近正在编辑，暂不覆盖 Agent 结果`,
                    });
                  }

                  return !isRecentlyEdited;
                });
                const latestFiles = useProjectStore.getState().files;
                const incomingPaths = new Set(generatedFiles.map((file) => file.path));
                const deletedPaths = isFinalEngineerSnapshot
                  ? Object.keys(latestFiles).filter((path) => {
                      if (incomingPaths.has(path)) {
                        return false;
                      }

                      const lastEditAt = lastManualEditAtRef.current[path] ?? 0;
                      const isRecentlyEdited = now - lastEditAt < 1500;

                      if (isRecentlyEdited) {
                        upsertStep({
                          id: `conflict:${path}`,
                          title: "文件冲突保护",
                          status: "running",
                          detail: `${path} 最近正在编辑，暂不删除 Agent 未返回的文件`,
                        });
                      }

                      return !isRecentlyEdited;
                    })
                  : [];

                safeFiles.forEach((f) => {
                  void writeFile(f.path, f.code);
                });

                if (safeFiles.length || deletedPaths.length) {
                  markDirtyPaths([
                    ...safeFiles.map((file) => file.path),
                    ...deletedPaths,
                  ]);
                }

                if (safeFiles.length) {
                  upsertFiles(safeFiles);
                }

                if (deletedPaths.length) {
                  removeFiles(deletedPaths);
                }

                const incomingTimestamps = agentData.fileTimestamps;
                if (Array.isArray(incomingTimestamps) && incomingTimestamps.length) {
                  const safePaths = new Set(safeFiles.map((file) => file.path));
                  const appliedTimestamps = incomingTimestamps.filter((row) => safePaths.has(row.path));

                  if (appliedTimestamps.length) {
                    setFileTimestamps(appliedTimestamps);
                  }
                }
                if (isFinalEngineerSnapshot) {
                  const syncFilesSnapshot = safeFiles.reduce<Record<string, string>>((acc, file) => {
                    acc[file.path] = file.code;
                    return acc;
                  }, {});
                  const syncPaths = [
                    ...Object.keys(syncFilesSnapshot),
                    ...deletedPaths,
                  ];

                  if (!syncPaths.length) {
                    continue;
                  }

                  upsertStep({
                    id: "sync-agent-files",
                    title: "同步 Agent 文件",
                    status: "running",
                    detail: `正在回写 ${syncPaths.length} 个 Agent 变更文件...`,
                  });
                  void syncProjectFilesToServer(syncFilesSnapshot, deletedPaths)
                    .then((syncResult) => {
                      if (syncResult.ok) {
                        [...syncResult.updatedPaths, ...syncResult.deletedPaths, ...syncResult.conflictPaths].forEach((path) => {
                          dirtyFilePathsRef.current.delete(path);
                        });
                      }

                      upsertStep({
                        id: "sync-agent-files",
                        title: "同步 Agent 文件",
                        status: syncResult.ok ? "done" : "error",
                        detail: syncResult.ok
                          ? `已同步 ${syncPaths.length} 个 Agent 变更到数据库`
                          : syncResult.error || "同步数据库失败，请稍后重试",
                      });
                    })
                    .catch((err: unknown) => {
                      upsertStep({
                        id: "sync-agent-files",
                        title: "同步 Agent 文件",
                        status: "error",
                        detail: err instanceof Error ? err.message : "写回数据库失败",
                      });
                    });
                }
              }
            } catch {
              // Ignore partial JSON chunks gracefully
            }
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log("Chat stream aborted by user");
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && isThinkingOrStreaming(lastMessage.status)) {
          updateLastAgentMessage(lastMessage.name, {
            status: "error",
            content: lastMessage.content + " 🛑 (已终止)",
          });
        }
      } else {
        console.error("Chat Error:", e);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [
    activeFilePath,
    appendMessage,
    executeWebContainerRequest,
    isGenerating,
    markDirtyPaths,
    messages,
    projectFiles,
    projectId,
    removeFiles,
    resetSteps,
    sessionId,
    setFileTimestamps,
    setInputValue,
    setIsGenerating,
    setSessionId,
    syncProjectFilesToServer,
    updateLastAgentMessage,
    upsertAgentMessage,
    upsertFiles,
    upsertStep,
    writeFile,
  ]);

  // 首页 prompt 跳转后自动触发：等容器就绪 + bootstrap 完成后，一次性消费 URL 中的 prompt 参数并直接发送
  useEffect(() => {
    if (isBootstrapping || !isContainerReady || !projectId || autoPromptConsumedRef.current) {
      return;
    }

    const initialPrompt = searchParams.get("prompt")?.trim();
    if (!initialPrompt) {
      return;
    }

    const initialAttachments = loadPendingHomeAttachments(projectId);

    autoPromptConsumedRef.current = true;
    void sendMessage(initialPrompt, {
      isNewProject: searchParams.get("newProject") === "true",
      clearInput: true,
      attachmentsOverride: initialAttachments,
    });

    // 清除临时 prompt 参数，但保留当前项目 id，避免 bootstrap 重置会话
    router.replace(`/workbench?project_id=${projectId}`);
  }, [isBootstrapping, isContainerReady, loadPendingHomeAttachments, projectId, router, searchParams, sendMessage]);

  const handleSend = async () => {
    await sendMessage(inputValue, { clearInput: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const resize = useCallback(
    (e: MouseEvent) => {
      if (isResizing) {
        const newWidth = (e.clientX / window.innerWidth) * 100;
        if (newWidth >= 20 && newWidth <= 30) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing, setSidebarWidth]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  useEffect(() => {
    if (!activeFilePath) {
      return;
    }

    expandDirectories(getParentDirectoryPaths(activeFilePath));
  }, [activeFilePath, expandDirectories]);

  const displayFiles = useMemo(
    () => ({ ...projectFiles, ...pendingEdits }),
    [projectFiles, pendingEdits],
  );

  const isCurrentFileDirty =
    activeFilePath !== null &&
    activeFilePath !== undefined &&
    activeFilePath in pendingEdits &&
    pendingEdits[activeFilePath] !== (projectFiles[activeFilePath] ?? "");

  const pendingPathsSet = useMemo(
    () =>
      new Set(
        Object.entries(pendingEdits)
          .filter(([path, draft]) => draft !== (projectFiles[path] ?? ""))
          .map(([path]) => path),
      ),
    [pendingEdits, projectFiles],
  );

  const handleEditorChange = (path: string, nextCode: string) => {
    lastManualEditAtRef.current[path] = Date.now();
    setPendingEdits((prev) => ({ ...prev, [path]: nextCode }));
  };

  const handleConfirmEdit = async () => {
    if (!activeFilePath) return;
    const content = pendingEdits[activeFilePath];
    if (typeof content !== "string") return;
    updateActiveFile(activeFilePath, content);
    void writeFile(activeFilePath, content);
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[activeFilePath];
      return next;
    });
    try {
      const result = await syncProjectFilesToServer({ [activeFilePath]: content });
      if (!result.ok) {
        console.error("[handleConfirmEdit] 保存失败:", result.error);
      } else {
        console.log("[handleConfirmEdit] 保存成功:", activeFilePath);
      }
    } catch (err) {
      console.error("[handleConfirmEdit] 保存异常:", err);
    }
  };

  const handleCancelEdit = () => {
    if (!activeFilePath) return;
    setPendingEdits((prev) => {
      const next = { ...prev };
      delete next[activeFilePath];
      return next;
    });
  };

  const handleRefreshPreview = () => {
    setPreviewRefreshSeed((prev) => prev + 1);
  };

  const handleApplyMergedCandidate = (path: string) => {
    const candidate = conflictCandidates[path];
    if (!candidate) return;

    markDirtyPaths([path]);
    updateActiveFile(path, candidate.mergedContent);
    void writeFile(path, candidate.mergedContent);
    setFileTimestamps([{ path, updated_at: candidate.serverUpdatedAt }]);
    clearConflictCandidate(path);
    upsertStep({
      id: `server-conflict:${path}`,
      title: "冲突合并候选已应用",
      status: "done",
      detail: `${path} 已写入本地合并候选，保存后将再次对账`,
    });
  };

  const handleApplyRemoteVersion = (path: string) => {
    const candidate = conflictCandidates[path];
    if (!candidate) return;

    markDirtyPaths([path]);
    updateActiveFile(path, candidate.serverContent);
    void writeFile(path, candidate.serverContent);
    setFileTimestamps([{ path, updated_at: candidate.serverUpdatedAt }]);
    clearConflictCandidate(path);
    upsertStep({
      id: `server-conflict:${path}`,
      title: "已应用远端版本",
      status: "done",
      detail: `${path} 已同步到服务端最新版本`,
    });
  };

  const handleDismissConflictCandidate = (path: string) => {
    clearConflictCandidate(path);
    upsertStep({
      id: `server-conflict:${path}`,
      title: "冲突候选已忽略",
      status: "done",
      detail: `${path} 冲突提示已关闭`,
    });
  };

  const conflictList = Object.values(conflictCandidates);
  const latestAgentMessageIndex = messages.reduce((latestIndex, message, index) => {
    return message.agent === "user" ? latestIndex : index;
  }, -1);

  return (
    <div className={`flex w-full h-screen bg-background text-foreground font-sans overflow-hidden transition-all duration-300 ${isHomeSidebarPinned ? "pl-64" : ""} ${isResizing ? "select-none" : ""}`}>
      {/* --- Left Sidebar (Agent Workspace) --- */}
      <motion.div
        initial={{ x: "-100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="min-w-[240px] h-full bg-muted/20 border-r border-border flex flex-col pt-5 relative"
        style={{ width: `${sidebarWidth}%` }}
      >
        <div
          onMouseDown={(e) => { e.preventDefault(); startResizing(); }}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-50"
        />
        {/* Header Logo */}
        <div className="px-5 mb-5 flex items-center gap-2.5">
          {isHomeSidebarPinned ? (
            <div className="px-1 text-sm font-medium text-foreground/80 truncate">
              {projectName}
            </div>
          ) : (
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group">
              <Atom className="size-5 text-foreground transition-transform duration-300 group-hover:scale-105" />
              <span className="text-foreground font-semibold text-[15px] tracking-tight">
                Vortex
              </span>
            </Link>
          )}
          <SidebarDrawer
            user={null}
            profile={null}
            onSidebarChange={setIsHomeSidebarPinned}
            renderTrigger={({ openSidebar, isPinned }) => (
              isPinned ? null : (
                <button
                  onMouseEnter={openSidebar}
                  onClick={openSidebar}
                  className="opacity-40 hover:opacity-100 transition-opacity p-1.5 -ml-1 select-none flex items-center justify-center cursor-pointer rounded-md"
                  aria-label="打开侧边栏"
                >
                  <PanelLeft className="size-4.5" />
                </button>
              )
            )}
          />
        </div>

        {!isHomeSidebarPinned && (
          <div className="px-6 pb-2 text-xs text-muted-foreground/70 truncate">
            {projectName}
          </div>
        )}

        {!!conflictList.length && (
          <div className="px-6 pb-3 space-y-2">
            {conflictList.map((candidate) => (
              <div key={candidate.path} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground/90">冲突文件: {candidate.path}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleApplyMergedCandidate(candidate.path)}
                      className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 transition-colors"
                    >
                      应用合并候选
                    </button>
                    <button
                      onClick={() => handleApplyRemoteVersion(candidate.path)}
                      className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 transition-colors"
                    >
                      应用远端版本
                    </button>
                    <button
                      onClick={() => handleDismissConflictCandidate(candidate.path)}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      忽略
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  远端已更新到 {candidate.serverUpdatedAt}，可先应用候选后再手工确认并保存。
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Chat Flow Container */}
        <div ref={messagesContainerRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto px-6 space-y-4 scrollbar-thin scrollbar-thumb-muted-foreground/30">
          {messages.map((msg, idx) => {
            const isFirstInDay = checkNeedDivider(msg.timestamp, idx > 0 ? messages[idx - 1].timestamp : undefined);
            const isToday = nowTs ? !checkNeedDivider(msg.timestamp, nowTs) : false;
            const timeStr = isToday ? formatTimeOnly(msg.timestamp) : formatMessageTime(msg.timestamp);

            return (
              <React.Fragment key={idx}>
                {isFirstInDay && (
                  <div className="w-full flex items-center my-8">
                    <div className="flex-1 border-t border-border/40"></div>
                    <span className="px-4 text-[11px] font-medium text-muted-foreground/50 tracking-wider">
                      {formatDividerDate(msg.timestamp)}
                    </span>
                    <div className="flex-1 border-t border-border/40"></div>
                  </div>
                )}
                
                {msg.agent === "user" ? (
                  <div className="flex gap-4 justify-end group mt-4">
                    <div className="flex items-end mb-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <span className="text-[11px] text-muted-foreground/50 mb-4">{timeStr}</span>
                    </div>
                    <div className="text-xs text-foreground/90 bg-muted/80 p-4 rounded-2xl rounded-tr-none border border-border/50 max-w-[85%] whitespace-pre-wrap leading-relaxed break-words">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4 group mt-4">
                    <div className="w-9 h-9 rounded-full bg-background flex-shrink-0 overflow-hidden border border-border p-1 flex items-center justify-center relative shadow-sm">
                      <Image
                        src={msg.avatar}
                        alt={msg.name}
                        fill
                        className="object-cover rounded-full"
                        sizes="36px"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      {(() => {
                        const workflowSteps = idx === latestAgentMessageIndex && steps.length
                          ? steps
                          : msg.workflowSteps ?? [];

                        return (
                          <>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground/80">{msg.name}</span>
                        <span className="text-muted-foreground/40 text-xs">|</span>
                        <span className="text-muted-foreground text-xs font-normal">
                          {AGENT_ROLE_LABEL_MAP[msg.agent] ?? msg.agent}
                        </span>
                        <span className="text-[11px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ml-1 pb-[1px]">
                          {timeStr}
                        </span>
                      </div>
                      <WorkflowAccordion steps={workflowSteps} />
                      <div className={`text-xs text-foreground/90 leading-relaxed bg-background p-4 rounded-2xl rounded-tl-none border border-border/60 shadow-sm mt-2 prose prose-xs prose-invert max-w-none break-words ${msg.status === 'thinking' ? 'animate-pulse' : ''} ${msg.status === 'streaming' ? 'border-primary/50 bg-muted/20' : ''}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {/* Scroll anchor and bottom spacing */}
          <div ref={messagesEndRef} className="h-8 pb-10 shrink-0" />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border bg-background">
          <div className="relative bg-muted/30 rounded-2xl border border-border focus-within:border-blue-500/50 transition-colors flex flex-col">
            <textarea
              className="w-full bg-transparent text-sm text-foreground p-4 pb-12 outline-none resize-none placeholder-muted-foreground"
              rows={3}
              placeholder="让智能体团队实现你的想法..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button
                onClick={isGenerating ? handleStop : handleSend}
                disabled={!isGenerating && inputValue.trim().length === 0}
                className="inline-flex size-7 items-center justify-center rounded-[10px] transition-all duration-300 disabled:cursor-not-allowed disabled:bg-foreground/10 enabled:bg-foreground enabled:hover:scale-105 enabled:hover:bg-foreground/90 text-background"
                title={isGenerating ? "停止生成" : "发送"}
              >
                {isGenerating ? <Square className="size-4 fill-current" /> : <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* --- Right Main Panel (Runtime/Preview) --- */}
      <div className="flex-1 h-full bg-background flex flex-col pt-2 border-none">
        <WorkbenchHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onRefreshPreview={handleRefreshPreview}
        />

        <div className="flex-1 overflow-hidden relative px-6 pb-4 mt-2">
          <div className="w-full h-full rounded-2xl overflow-hidden border border-border/40 shadow-sm flex flex-col bg-background/50">
            {activeTab === "code" ? (
              <div className="flex h-full">
                <div className="w-64 border-r border-border/60 bg-muted/20 overflow-y-auto">
                  <WorkbenchFileTree
                    activeFilePath={activeFilePath}
                    expandedDirectories={expandedDirectories}
                    files={projectFiles}
                    pendingPaths={pendingPathsSet}
                    onSelectFile={setActiveFilePath}
                    onToggleDirectory={toggleDirectory}
                  />
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                  {isCurrentFileDirty && (
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
                      <span className="text-xs text-muted-foreground flex-1 truncate">
                        {activeFilePath} — 有未保存的更改
                      </span>
                      <button
                        onClick={() => void handleConfirmEdit()}
                        title="确认保存"
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors"
                      >
                        <Check size={13} />
                        保存
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        title="丢弃更改"
                        className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted/50 text-muted-foreground hover:bg-muted transition-colors"
                      >
                        <X size={13} />
                        放弃
                      </button>
                    </div>
                  )}
                  <div className="flex-1 overflow-hidden">
                    <MonacoCodeEditor
                      activePath={activeFilePath}
                      files={displayFiles}
                      onCodeChange={handleEditorChange}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative h-full w-full bg-muted/10">
                {serverUrl ? (
                  <iframe
                    key={`${serverUrl}-${previewRefreshSeed}`}
                    title="VORTEX Preview"
                    src={serverUrl}
                    className="w-full h-full border-0"
                  />
                ) : (
                  <WorkbenchLoadingState />
                )}
                {isGenerating && serverUrl && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm">
                    <div className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-xs text-muted-foreground">正在生成中…</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkbenchHeader({
  activeTab,
  setActiveTab,
  onRefreshPreview,
}: {
  activeTab: "preview" | "code";
  setActiveTab: (tab: "preview" | "code") => void;
  onRefreshPreview: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            setActiveTab("preview");
            onRefreshPreview();
          }}
          className={`flex items-center justify-center transition-all overflow-hidden ${
            activeTab === "preview"
              ? "bg-muted/50 text-foreground px-3 h-7 rounded-full gap-1.5 font-medium"
              : "w-7 h-7 rounded-full border border-border/50 hover:bg-muted/30 text-muted-foreground"
          }`}
        >
          <Image
            src="/workbench/app-window.svg"
            alt="App Viewer"
            width={14}
            height={14}
            className={activeTab === "preview" ? "opacity-100 dark:invert" : "opacity-60 dark:invert"}
          />
          {activeTab === "preview" && (
            <span className="text-xs shrink-0 whitespace-nowrap">
              应用查看器
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("code")}
          className={`flex items-center justify-center transition-all overflow-hidden ${
            activeTab === "code"
              ? "bg-muted/50 text-foreground px-3 h-7 rounded-full gap-1.5 font-medium"
              : "w-7 h-7 rounded-full border border-border/50 hover:bg-muted/30 text-muted-foreground"
          }`}
        >
          <Image
            src="/workbench/file-terminal.svg"
            alt="Editor"
            width={14}
            height={14}
            className={activeTab === "code" ? "opacity-100 dark:invert" : "opacity-60 dark:invert"}
          />
          {activeTab === "code" && (
            <span className="text-xs shrink-0 whitespace-nowrap">
              编辑器
            </span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onRefreshPreview}
          className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center h-7 w-7"
          title="重新加载应用查看器"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function WorkbenchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading workbench...</div>}>
      <WorkbenchContent />
    </Suspense>
  );
}

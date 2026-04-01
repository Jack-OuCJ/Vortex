"use client";

import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { RefreshCw, Send, Square } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { MonacoCodeEditor } from "@/components/MonacoCodeEditor";
import { useWebContainer } from "@/hooks/useWebContainer";
import { useChatStore } from "@/stores/chatStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";

type ProjectSummary = {
  id: string;
  name: string;
};

type ProjectFile = {
  path: string;
  content: string;
  updated_at?: string;
};

type AgentStreamEvent = {
  eventType?: "agent";
  agent: "pm" | "architect" | "engineer" | "debug";
  name: string;
  status: "thinking" | "done" | "error" | "streaming";
  content?: string;
  projectFiles?: Array<{ path: string; code: string }>;
  fileTimestamps?: Array<{ path: string; updated_at: string }>;
};

type SessionStreamEvent = {
  eventType: "session";
  sessionId: string;
};

type StepStreamEvent = {
  eventType: "step";
  stepId: "pm" | "architect" | "engineer" | "debug" | "direct_reply";
  title: string;
  status: "running" | "done" | "error";
  detail?: string;
};

type ToolStreamEvent = {
  eventType: "tool";
  callId: string;
  action: "tool_start" | "tool_input_delta" | "tool_result" | "tool_error";
  toolName:
    | "analyze_demand"
    | "plan_architecture"
    | "generate_project_files"
    | "debug_fix"
    | "read_file"
    | "write_file";
  detail?: string;
};

type StreamEvent = AgentStreamEvent | SessionStreamEvent | StepStreamEvent | ToolStreamEvent;

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

export function WorkbenchContent() {
  const {
    activeTab,
    setActiveTab,
    sidebarWidth,
    setSidebarWidth,
    steps,
    resetSteps,
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
  } = useChatStore();

  const [nowTs, setNowTs] = useState<number | null>(null);
  const [previewRefreshSeed, setPreviewRefreshSeed] = useState(0);
  const [isCopyingShareLink, setIsCopyingShareLink] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastManualEditAtRef = useRef<Record<string, number>>({});
  const { isReady: isContainerReady, serverUrl, logs, syncFiles, writeFile } = useWebContainer();

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  useEffect(() => {
    setNowTs(Date.now());
  }, []);

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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let mounted = true;

    const bootstrapProject = async () => {
      try {
        const listRes = await fetch("/api/projects", { method: "GET" });
        if (!listRes.ok) {
          return;
        }

        const listJson = (await listRes.json()) as { projects?: ProjectSummary[] };
        let activeProject = listJson.projects?.[0];

        if (!activeProject) {
          const createRes = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `Project ${new Date().toISOString().slice(0, 16)}` }),
          });

          if (!createRes.ok) {
            return;
          }

          const createJson = (await createRes.json()) as { project?: ProjectSummary };
          activeProject = createJson.project;
        }

        if (!activeProject || !mounted) return;

        setProjectMeta(activeProject.id, activeProject.name);

        const filesRes = await fetch(`/api/projects/${activeProject.id}/files`, {
          method: "GET",
        });

        if (!filesRes.ok) {
          return;
        }

        const filesJson = (await filesRes.json()) as { files?: ProjectFile[] };
        if (!mounted) return;
        setRemoteFiles(filesJson.files ?? []);
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
  }, [setIsBootstrapping, setProjectMeta, setRemoteFiles]);

  useEffect(() => {
    if (!projectId || isBootstrapping) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const files = Object.entries(projectFiles).map(([path, content]) => ({
        path,
        content,
        expectedUpdatedAt: fileTimestamps[path] ?? null,
      }));

      void fetch(`/api/projects/${projectId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      })
        .then(async (response) => {
          const isConflict = response.status === 409;
          if (!response.ok && !isConflict) {
            return;
          }

          const payload = (await response.json()) as {
            fileTimestamps?: Array<{ path: string; updated_at: string }>;
            conflicts?: Array<{
              path: string;
              expectedUpdatedAt: string | null;
              serverUpdatedAt: string;
              serverContent: string;
            }>;
          };

          if (Array.isArray(payload.fileTimestamps) && payload.fileTimestamps.length) {
            setFileTimestamps(payload.fileTimestamps);
          }

          if (Array.isArray(payload.conflicts) && payload.conflicts.length) {
            const candidates = payload.conflicts.map((conflict) => {
              const localContent = projectFiles[conflict.path] ?? "";
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
        })
        .catch(() => {
          // noop
        });
    }, 1000);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [
    fileTimestamps,
    isBootstrapping,
    projectFiles,
    projectId,
    setFileTimestamps,
    upsertConflictCandidates,
    upsertStep,
  ]);

  useEffect(() => {
    if (!isContainerReady || isBootstrapping) {
      return;
    }

    void syncFiles(projectFiles);
  }, [isBootstrapping, isContainerReady, projectFiles, syncFiles]);

  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating) return;
    const userMsg = inputValue.trim();

    appendMessage({
      agent: "user",
      name: "You",
      avatar: "/teams-avatar/Leader.png",
      content: userMsg,
      timestamp: Date.now(),
    });
    resetSteps();
    setInputValue("");
    
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      // Create project files array format for backend
      const currentFiles = Object.entries(projectFiles).map(([path, code]) => ({ path, code }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          projectFiles: currentFiles,
          projectId,
          sessionId,
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
                });
                continue;
              }

              if (data.eventType === "tool") {
                const stepId = `tool:${data.callId}`;
                const title = `工具: ${data.toolName}`;

                if (data.action === "tool_start" || data.action === "tool_input_delta") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "running",
                    detail: data.detail,
                  });
                }

                if (data.action === "tool_result") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "done",
                    detail: data.detail,
                  });
                }

                if (data.action === "tool_error") {
                  upsertStep({
                    id: stepId,
                    title,
                    status: "error",
                    detail: data.detail,
                  });
                }

                continue;
              }
              
              const agentData = data as AgentStreamEvent;

              const avatarMap: Record<string, string> = {
                pm: "/teams-avatar/pm.png",
                architect: "/teams-avatar/50-engineer.png",
                engineer: "/teams-avatar/50-engineer.png",
                debug: "/teams-avatar/50-engineer.png",
              };
              
              const avatar = avatarMap[agentData.agent] || avatarMap.engineer;

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

                safeFiles.forEach((f) => {
                  void writeFile(f.path, f.code);
                });

                if (safeFiles.length) {
                  upsertFiles(safeFiles);
                }

                const incomingTimestamps = agentData.fileTimestamps;
                if (Array.isArray(incomingTimestamps) && incomingTimestamps.length) {
                  const safePaths = new Set(safeFiles.map((file) => file.path));
                  const appliedTimestamps = incomingTimestamps.filter((row) => safePaths.has(row.path));

                  if (appliedTimestamps.length) {
                    setFileTimestamps(appliedTimestamps);
                  }
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

  const sortedFilePaths = Object.keys(projectFiles).sort();

  const handleEditorChange = (path: string, nextCode: string) => {
    lastManualEditAtRef.current[path] = Date.now();
    updateActiveFile(path, nextCode);
    void writeFile(path, nextCode);
  };

  const handleRefreshPreview = () => {
    setPreviewRefreshSeed((prev) => prev + 1);
  };

  const handleCopyShareLink = async () => {
    if (!projectId || isCopyingShareLink) {
      return;
    }

    setIsCopyingShareLink(true);
    try {
      const patchRes = await fetch(`/api/projects/${projectId}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: true }),
      });

      if (!patchRes.ok) {
        throw new Error(`Failed to enable sharing (${patchRes.status})`);
      }

      const patchJson = (await patchRes.json()) as { shareUrl?: string };
      if (!patchJson.shareUrl) {
        throw new Error("Missing share URL");
      }

      await navigator.clipboard.writeText(patchJson.shareUrl);
      upsertStep({
        id: "share-link",
        title: "分享链接",
        status: "done",
        detail: "分享链接已复制到剪贴板",
      });
    } catch (error) {
      upsertStep({
        id: "share-link",
        title: "分享链接",
        status: "error",
        detail: error instanceof Error ? error.message : "复制分享链接失败",
      });
    } finally {
      setIsCopyingShareLink(false);
    }
  };

  const handleApplyMergedCandidate = (path: string) => {
    const candidate = conflictCandidates[path];
    if (!candidate) return;

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

  return (
    <div className="flex w-full h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* --- Left Sidebar (Agent Workspace) --- */}
      <motion.div
        initial={{ x: "-100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="min-w-[240px] h-full bg-muted/20 border-r border-border flex flex-col pt-5 relative"
        style={{ width: `${sidebarWidth}%` }}
      >
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-50"
        />
        {/* Header Logo */}
        <Link href="/" className="px-5 mb-5 flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer">
          <div className="w-[26px] h-[26px] rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold italic text-xs">A</span>
          </div>
          <span className="text-foreground font-bold text-sm tracking-wide">
            ATOMS
          </span>
        </Link>

        <div className="px-6 pb-2 text-xs text-muted-foreground/70 truncate">
          {projectName}
        </div>

        {!!steps.length && (
          <div className="px-6 pb-3 space-y-2">
            {steps.map((step) => (
              <div key={step.id} className="rounded-lg border border-border/50 bg-background/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground/90">{step.title}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      step.status === "running"
                        ? "bg-blue-500/20 text-blue-300"
                        : step.status === "done"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {step.status}
                  </span>
                </div>
                {step.detail && (
                  <p className="text-[11px] text-muted-foreground mt-1">{step.detail}</p>
                )}
              </div>
            ))}
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
        <div className="flex-1 overflow-y-auto px-6 space-y-4 scrollbar-thin scrollbar-thumb-muted-foreground/30">
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
                    <div className="text-sm text-foreground/90 bg-muted/80 p-4 rounded-2xl rounded-tr-none border border-border/50 max-w-[85%] whitespace-pre-wrap leading-relaxed">
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
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-sm font-semibold text-foreground/80">{msg.name}</span>
                        <span className="text-muted-foreground/40 text-xs">|</span>
                        <span className="text-muted-foreground text-xs font-normal">
                          {msg.agent === "engineer" ? "工程师" : msg.agent === "pm" ? "产品经理" : msg.agent === "architect" ? "架构师" : msg.agent === "debug" ? "调试测试" : msg.agent}
                        </span>
                        <span className="text-[11px] text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ml-1 pb-[1px]">
                          {timeStr}
                        </span>
                      </div>
                      <div className={`text-sm text-foreground/90 leading-relaxed bg-background p-4 rounded-2xl rounded-tl-none border border-border/60 shadow-sm mt-2 ${msg.status === 'thinking' ? 'animate-pulse' : ''} ${msg.status === 'streaming' ? 'border-primary/50 bg-muted/20' : ''}`}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {/* Scroll anchor and bottom spacing */}
          <div ref={messagesEndRef} className="h-8 pb-10 shrink-0" />
        </div>

        {/* Suggestion Pills */}
        <div className="px-6 py-4 flex flex-wrap gap-2">
          <button className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors backdrop-blur-sm">
            Add mood tracker
          </button>
          <button className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors backdrop-blur-sm">
            Add calming animation
          </button>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border bg-background">
          <div className="relative bg-muted/30 rounded-2xl border border-border focus-within:border-blue-500/50 transition-colors overflow-hidden flex flex-col">
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
                className={`p-2 rounded-xl text-white transition-all flex items-center justify-center shadow-lg active:scale-95 ${
                  isGenerating
                    ? "bg-red-500 hover:bg-red-600 hover:scale-95 shadow-red-900/20"
                    : "bg-blue-600 hover:bg-blue-500 hover:scale-105 shadow-blue-900/20"
                }`}
                title={isGenerating ? "停止生成" : "发送"}
              >
                {isGenerating ? <Square className="w-4 h-4 fill-current" /> : <Send className="w-4 h-4" />}
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
          onCopyShareLink={handleCopyShareLink}
          isCopyingShareLink={isCopyingShareLink}
        />

        <div className="flex-1 overflow-hidden relative px-6 pb-4 mt-2">
          <div className="w-full h-full rounded-2xl overflow-hidden border border-border/40 shadow-sm flex flex-col bg-background/50">
            {activeTab === "code" ? (
              <div className="flex h-full">
                <div className="w-64 border-r border-border/60 bg-muted/20 overflow-y-auto">
                  {sortedFilePaths.map((path) => (
                    <button
                      key={path}
                      onClick={() => setActiveFilePath(path)}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors border-b border-border/30 ${
                        path === activeFilePath
                          ? "bg-blue-500/15 text-foreground"
                          : "text-muted-foreground hover:bg-muted/40"
                      }`}
                    >
                      {path}
                    </button>
                  ))}
                </div>
                <div className="flex-1">
                  <MonacoCodeEditor
                    activePath={activeFilePath}
                    files={projectFiles}
                    onCodeChange={handleEditorChange}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full w-full bg-muted/10">
                {serverUrl ? (
                  <iframe
                    key={`${serverUrl}-${previewRefreshSeed}`}
                    title="ATOMS Preview"
                    src={serverUrl}
                    className="w-full h-full border-0"
                  />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center text-sm text-muted-foreground px-6 text-center gap-3">
                    <p>正在启动 WebContainer 运行时...</p>
                    <p className="text-xs text-muted-foreground/70">
                      {isContainerReady ? "容器已启动，正在安装依赖并启动开发服务器" : "正在初始化容器内核"}
                    </p>
                    {!!logs.length && (
                      <div className="max-w-3xl w-full bg-black/80 text-green-300 rounded-lg p-3 text-left text-xs overflow-auto max-h-36">
                        {logs.slice(-8).map((line, idx) => (
                          <div key={idx}>{line}</div>
                        ))}
                      </div>
                    )}
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
  onCopyShareLink,
  isCopyingShareLink,
}: {
  activeTab: "preview" | "code";
  setActiveTab: (tab: "preview" | "code") => void;
  onRefreshPreview: () => void;
  onCopyShareLink: () => void;
  isCopyingShareLink: boolean;
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
          onClick={onCopyShareLink}
          className="rounded-lg px-2.5 h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="复制分享预览链接"
          disabled={isCopyingShareLink}
        >
          {isCopyingShareLink ? "处理中..." : "复制分享链接"}
        </button>
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

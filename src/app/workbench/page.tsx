"use client";

import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Send, RefreshCw, Maximize2, Sparkles, Square } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackFileExplorer,
  SandpackPreview,
  useSandpack,
  SandpackCodeEditor,
} from "@codesandbox/sandpack-react";

export function WorkbenchContent() {
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
  const [inputValue, setInputValue] = useState("");
  const [nowTs, setNowTs] = useState<number | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  useEffect(() => {
    setNowTs(Date.now());
  }, []);

  const mockInitialMessages = [
    {
      agent: "pm",
      name: "Emma",
      avatar: "/teams-avatar/pm.png",
      content:
        "Hi! I am Emma, your Product Manager. What are we building today?",
      timestamp: new Date("2026-03-29T12:00:00").getTime(),
    },
    {
      agent: "engineer",
      name: "Alex",
      avatar: "/teams-avatar/50-engineer.png",
      content:
        "Alex here! Ready to dive into the code and build something great.",
      timestamp: new Date("2026-03-31T12:30:00").getTime(),
    },
  ];

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

  const [messages, setMessages] = useState<any[]>(mockInitialMessages);
  const [sandpackFiles, setSandpackFiles] = useState<Record<string, string>>({
    "/App.tsx": `export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Hello from Atom's Multi-Agent Demo</h1>
      <p>This is a live preview of your generated app.</p>
    </div>
  )
}`,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating) return;
    const userMsg = inputValue.trim();

    setMessages((prev) => [
      ...prev,
      {
        agent: "user",
        name: "You",
        avatar: "/teams-avatar/Leader.png",
        content: userMsg,
        timestamp: Date.now(),
      },
    ]);
    setInputValue("");
    
    setIsGenerating(true);
    abortControllerRef.current = new AbortController();

    try {
      // Create project files array format for backend
      const currentFiles = Object.entries(sandpackFiles).map(([path, code]) => ({ path, code }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg, projectFiles: currentFiles }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.body) return;
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              const avatarMap: Record<string, string> = {
                pm: "/teams-avatar/pm.png",
                architect: "/teams-avatar/50-engineer.png",
                engineer: "/teams-avatar/50-engineer.png",
                debug: "/teams-avatar/50-engineer.png",
              };
              
              const avatar = avatarMap[data.agent] || avatarMap.engineer;

              setMessages((prev) => {
                const newMsgs = [...prev];
                // Find last message by this specific agent to update status
                const lastIdx = newMsgs.map(m => m.name).lastIndexOf(data.name);
                
                if (lastIdx !== -1 && ["thinking", "streaming"].includes(newMsgs[lastIdx].status)) {
                  newMsgs[lastIdx] = {
                    ...newMsgs[lastIdx],
                    content: data.content || newMsgs[lastIdx].content,
                    status: data.status,
                  };
                } else {
                  newMsgs.push({
                    agent: data.agent,
                    name: data.name,
                    avatar,
                    content: data.content || "",
                    status: data.status,
                    timestamp: Date.now(),
                  });
                }
                return newMsgs;
              });

              if (data.projectFiles && Array.isArray(data.projectFiles)) {
                setSandpackFiles((prevFiles) => {
                  const updatedFiles = { ...prevFiles };
                  data.projectFiles.forEach((f: any) => {
                    updatedFiles[f.path] = f.code;
                  });
                  return updatedFiles;
                });
              }
            } catch (e) {
              // Ignore partial JSON chunks gracefully
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") {
        console.log("Chat stream aborted by user");
        setMessages((prev) => {
          const newMsgs = [...prev];
          const lastIdx = newMsgs.length - 1;
          if (lastIdx >= 0 && ["thinking", "streaming"].includes(newMsgs[lastIdx].status)) {
            newMsgs[lastIdx] = {
              ...newMsgs[lastIdx],
              status: "error",
              content: newMsgs[lastIdx].content + " 🛑 (已终止)",
            };
          }
          return newMsgs;
        });
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

  const [sidebarWidth, setSidebarWidth] = useState(25);
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
    [isResizing]
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <div className="flex w-full h-screen bg-background text-foreground font-sans overflow-hidden">
      {/* --- Left Sidebar (Agent Workspace) --- */}
      <motion.div
        initial={{ x: "-100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="min-w-[300px] h-full bg-muted/20 border-r border-border flex flex-col pt-6 relative"
        style={{ width: `${sidebarWidth}%` }}
      >
        <div
          onMouseDown={startResizing}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-50"
        />
        {/* Header Logo */}
        <Link href="/" className="px-6 mb-6 flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
            <span className="text-white font-bold italic">A</span>
          </div>
          <span className="text-foreground font-bold text-lg tracking-wide">
            ATOMS
          </span>
        </Link>

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

      {/* --- Right Main Panel (Sandbox/Preview) --- */}
      <div className="flex-1 h-full bg-background flex flex-col pt-2 border-none">
        <SandpackProvider
          template="react-ts"
          files={sandpackFiles}
          customSetup={{
            dependencies: {
              "lucide-react": "latest",
              "framer-motion": "latest",
            },
          }}
        >
          {/* App Viewer Header / Tabs */}
          <SandpackHeader activeTab={activeTab} setActiveTab={setActiveTab} />

          {/* Sandpack Integration Workspace */}
          <div className="flex-1 overflow-hidden relative px-6 pb-4 mt-2">
            <div className="w-full h-full rounded-2xl overflow-hidden border border-border/40 shadow-sm flex flex-col bg-background/50">
              <SandpackLayout
                style={
                  {
                    height: "100%",
                    border: "none",
                    backgroundColor: "transparent",
                    "--sp-colors-bg-default": "transparent",
                  } as React.CSSProperties
                }
              >
                {activeTab === "code" ? (
                  <>
                    <SandpackFileExplorer
                      autoHiddenFiles={true}
                      style={
                        {
                          width: "250px",
                          height: "100%",
                          borderRight: "1px solid var(--border)",
                          backgroundColor: "transparent",
                        } as React.CSSProperties
                      }
                    />
                    <SandpackCodeEditor
                      showLineNumbers
                      showTabs
                      style={{ height: "100%", flex: 1 }}
                    />
                  </>
                ) : (
                  <SandpackPreview
                    showNavigator={false}
                    showOpenInCodeSandbox={false}
                    showRefreshButton={false}
                    style={
                      {
                        flex: 1,
                        height: "100%",
                        backgroundColor: "transparent",
                      } as React.CSSProperties
                    }
                  />
                )}
              </SandpackLayout>
            </div>
          </div>
        </SandpackProvider>
      </div>
    </div>
  );
}

function SandpackHeader({
  activeTab,
  setActiveTab,
}: {
  activeTab: "preview" | "code";
  setActiveTab: (tab: "preview" | "code") => void;
}) {
  const { sandpack, dispatch } = useSandpack();

  return (
    <div className="flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => {
            setActiveTab("preview");
            dispatch({ type: "refresh" });
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
          onClick={() => dispatch({ type: "refresh" })}
          className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center justify-center h-7 w-7"
          title="重新加载应用查看器"
        >
          <Image
            src="/workbench/refresh-cw.svg"
            alt="Reload"
            width={14}
            height={14}
            className="opacity-70 group-hover:opacity-100 dark:invert"
          />
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

"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Send, RefreshCw, Maximize2, Sparkles } from "lucide-react";
import Image from "next/image";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackFileExplorer,
  SandpackPreview,
} from "@codesandbox/sandpack-react";

export default function WorkbenchPage() {
  const [inputValue, setInputValue] = useState("");

  const mockMessages = [
    {
      agent: "pm",
      name: "Emma",
      avatar: "/teams-avatar/pm.png", // Ensure you have this image in public/
      content:
        "Hi! I am Emma, your Product Manager. What are we building today?",
    },
    {
      agent: "engineer",
      name: "Alex",
      avatar: "/teams-avatar/50-engineer.png", // Ensure you have this image in public/
      content:
        "Alex here! Ready to dive into the code and build something great.",
    },
  ];

  return (
    <div className="flex w-full h-screen bg-neutral-900 text-neutral-100 font-sans overflow-hidden">
      {/* --- Left Sidebar (Agent Workspace) --- */}
      <motion.div
        initial={{ x: "-100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-1/4 min-w-[300px] h-full bg-neutral-950 border-r border-neutral-800 flex flex-col pt-6"
      >
        {/* Header Logo */}
        <div className="px-6 mb-6 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold italic">A</span>
          </div>
          <span className="text-white font-bold text-lg tracking-wide">
            ATOMS
          </span>
        </div>

        {/* Chat Flow Container */}
        <div className="flex-1 overflow-y-auto px-6 space-y-6 scrollbar-thin scrollbar-thumb-neutral-700">
          {mockMessages.map((msg, idx) => (
            <div key={idx} className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-neutral-800 flex-shrink-0 overflow-hidden border border-neutral-700 p-1 flex items-center justify-center relative">
                <Image
                  src={msg.avatar}
                  alt={msg.name}
                  fill
                  className="object-cover rounded-full"
                  sizes="40px"
                />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-semibold text-blue-400">
                    {msg.name}{" "}
                    <span className="text-neutral-500 font-normal">
                      ({msg.agent})
                    </span>
                  </span>
                </div>
                <div className="text-sm text-neutral-300 leading-relaxed bg-neutral-800/50 p-3 rounded-2xl rounded-tl-none border border-neutral-800">
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Suggestion Pills */}
        <div className="px-6 py-4 flex flex-wrap gap-2">
          <button className="text-xs px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors backdrop-blur-sm">
            Add mood tracker
          </button>
          <button className="text-xs px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 transition-colors backdrop-blur-sm">
            Add calming animation
          </button>
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950">
          <div className="relative bg-neutral-900 rounded-2xl border border-neutral-700 focus-within:border-blue-500/50 transition-colors overflow-hidden">
            <textarea
              className="w-full bg-transparent text-sm text-neutral-200 p-4 pb-12 outline-none resize-none placeholder-neutral-500"
              rows={3}
              placeholder="让智能体团队实现你的想法..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <button className="p-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-all hover:scale-105 active:scale-95 flex items-center justify-center shadow-lg shadow-blue-900/20">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="text-center mt-3 text-xs text-neutral-600">
            Powered by Atoms Team Mode
          </div>
        </div>
      </motion.div>

      {/* --- Right Main Panel (Sandbox/Preview) --- */}
      <div className="w-3/4 h-full bg-[#151515] flex flex-col">
        {/* App Viewer Header */}
        <div className="h-14 bg-[#111111] border-b border-neutral-800/80 flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-neutral-300">
              应用查看器
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sandpack Integration */}
        <div className="flex-1 overflow-hidden relative p-4">
          {/* Wrap sandpack in a container to enforce our theme visually */}
          <div className="w-full h-full rounded-2xl overflow-hidden border border-neutral-800/50 shadow-2xl bg-[#1e1e1e]">
            <SandpackProvider
              template="react-ts"
              theme="dark"
              files={{
                "/App.tsx": `export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Hello from Atom's Multi-Agent Demo</h1>
      <p>This is a live preview of your generated app.</p>
    </div>
  )
}`,
              }}
              customSetup={{
                dependencies: {
                  "lucide-react": "latest",
                  "framer-motion": "latest",
                },
              }}
            >
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
                <SandpackFileExplorer
                  autoHiddenFiles={true}
                  style={
                    {
                      width: "250px",
                      height: "100%",
                      borderRight: "1px solid #2a2a2a",
                      backgroundColor: "#151515",
                    } as React.CSSProperties
                  }
                />
                {/* Hiding code editor for now as requested */}
                {/* <SandpackCodeEditor /> */}

                <SandpackPreview
                  showNavigator={true}
                  showOpenInCodeSandbox={false}
                  showRefreshButton={false} // Custom header has refresh
                  style={
                    {
                      flex: 1,
                      height: "100%",
                      backgroundColor: "#fff", // Preview contents background
                    } as React.CSSProperties
                  }
                />
              </SandpackLayout>
            </SandpackProvider>
          </div>
        </div>
      </div>
    </div>
  );
}

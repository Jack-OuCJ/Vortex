"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Plus, ArrowRight } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { SidebarAndHeader } from "@/components/SidebarAndHeader";

type UserProfile = {
  email: string | null;
  username: string | null;
  avatar_url: string | null;
};

type AgentBadge = {
  label: string;
  bg: string;
};

const AGENTS: AgentBadge[] = [
  { label: "M", bg: "#ffb06f" },
  { label: "S", bg: "#d2c7b4" },
  { label: "E", bg: "#ff97b5" },
  { label: "B", bg: "#9aa4bf" },
  { label: "A", bg: "#7db6ff" },
  { label: "D", bg: "#6acb88" },
  { label: "I", bg: "#b586e6" },
];

export default function HomeClient({
  user,
  profile,
}: {
  user: User | null;
  profile: UserProfile | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [isSidebarPinned, setIsSidebarPinned] = useState(false);
  const canSubmit = useMemo(() => prompt.trim().length > 0, [prompt]);

  return (
    <div
      className={`bg-background min-h-screen w-full text-foreground transition-all duration-300 ${isSidebarPinned && user ? "pl-64" : ""}`}
    >
      <SidebarAndHeader
        user={user}
        profile={profile}
        onSidebarChange={setIsSidebarPinned}
      />

      <main className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-4 pb-14 pt-24 sm:px-6 sm:pt-32 lg:pt-36">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex w-full max-w-[760px] flex-col items-center"
        >
          <div className="mb-5 flex items-center justify-center">
            {AGENTS.map((agent, index) => (
              <motion.div
                key={agent.label}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 + index * 0.06, duration: 0.35 }}
                style={{
                  zIndex: AGENTS.length - index,
                  backgroundColor: agent.bg,
                }}
                className="-ml-2 flex size-11 items-center justify-center rounded-full border-2 border-background text-sm font-semibold text-black/80 first:ml-0"
              >
                {agent.label}
              </motion.div>
            ))}
          </div>

          <h1 className="text-center text-[36px] font-semibold leading-[1.1] tracking-tight sm:text-[52px] lg:text-[60px]">
            把想法变成可销售的
            <span className="font-serif italic"> 产品</span>
          </h1>

          <p className="mt-4 text-center text-[14px] opacity-70 sm:text-[16px] md:whitespace-nowrap">
            AI 员工用于验证想法、构建产品并获取客户。几分钟内完成。无需编码。
          </p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.45 }}
            className="mt-8 w-full max-w-[700px] rounded-[16px] border-border bg-muted p-2.5 shadow-sm transition-all duration-300 hover:scale-[1.01] border "
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="创建一个具有用户登录和数据库存储功能的SaaS订阅应用..."
              className="h-[88px] w-full resize-none rounded-xl border-0 bg-transparent p-2 text-[16px] text-foreground outline-none placeholder:text-foreground/40"
            />

            <div className="mt-2 flex items-center justify-between px-2 pb-1">
              <button
                aria-label="上传附件"
                className="inline-flex size-8 items-center justify-center rounded-[8px] border border-foreground/10 bg-background/80 text-foreground/60 transition-all duration-300 hover:scale-105 hover:bg-background"
              >
                <Plus className="size-4" />
              </button>

              <button
                disabled={!canSubmit}
                className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 disabled:cursor-not-allowed disabled:bg-primary/50 disabled:text-primary-foreground/85 enabled:bg-primary enabled:hover:scale-105 enabled:hover:bg-primary/90"
              >
                免费开始
                <ArrowRight className="size-4" />
              </button>
            </div>
          </motion.div>
        </motion.section>
      </main>
    </div>
  );
}

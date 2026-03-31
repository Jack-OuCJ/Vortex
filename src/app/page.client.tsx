"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Plus, ArrowRight } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { SidebarAndHeader } from "@/components/SidebarAndHeader";
import { useRouter } from "next/navigation";

type UserProfile = {
  email: string | null;
  username: string | null;
  avatar_url: string | null;
};

type AgentBadge = {
  src: string;
  name: string;
  role: string;
};



const AGENTS: AgentBadge[] = [
  { src: "/teams-avatar/Leader.png", name: "Emma", role: "团队领导" },
  { src: "/teams-avatar/seo.png", name: "Sarah", role: "SEO专家" },
  { src: "/teams-avatar/pm.png", name: "Liam", role: "产品经理" },
  { src: "/teams-avatar/architect.png", name: "Bob", role: "架构师" },
  { src: "/teams-avatar/50-engineer.png", name: "Alex", role: "工程师" },
  { src: "/teams-avatar/data-analyst.png", name: "David", role: "技术分析师" },
  { src: "/teams-avatar/deep-researcher.png", name: "Maya", role: "深度研究员" },
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
  const router = useRouter();

  const canSubmit = useMemo(() => prompt.trim().length > 0, [prompt]);

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    router.push(`/workbench?prompt=${encodeURIComponent(prompt.trim())}`);
  }, [canSubmit, prompt, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

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
                key={agent.role}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                whileHover={{ scale: 1.2, zIndex: 10, y: -4 }}
                transition={{
                  delay: 0.1 + index * 0.06,
                  duration: 0.35,
                  scale: { duration: 0.2 },
                }}
                className="group relative -ml-3 flex size-12 cursor-pointer items-center justify-center overflow-visible rounded-full border-2 border-background bg-secondary transition-shadow hover:shadow-lg first:ml-0 sm:size-14"
                style={{ zIndex: AGENTS.length - index }}
              >
                <div className="relative size-full overflow-hidden rounded-full">
                  <Image
                    src={agent.src}
                    alt={`${agent.name} - ${agent.role}`}
                    fill
                    sizes="(max-width: 768px) 48px, 56px"
                    className="object-cover"
                    priority
                  />
                </div>
                {/* Tooltip */}
                <div className="pointer-events-none absolute -bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center whitespace-nowrap opacity-0 transition-all duration-200 group-hover:opacity-100">
                  <div className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md">
                    {agent.role} ({agent.name})
                  </div>
                </div>
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
              onKeyDown={handleKeyDown}
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
                onClick={handleSubmit}
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

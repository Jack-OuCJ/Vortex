"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Square, LayoutGrid } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { User } from "@supabase/supabase-js";
import { SidebarAndHeader } from "@/components/SidebarAndHeader";
import { useRouter } from "next/navigation";
import { useHistoryStore } from "@/stores/historyStore";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const router = useRouter();

  const { projects, fetchProjects } = useHistoryStore();

  useEffect(() => {
    if (user?.id) {
      fetchProjects(user.id);
    }
  }, [user?.id, fetchProjects]);

  const canSubmit = useMemo(() => prompt.trim().length > 0, [prompt]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return;

    const trimmedPrompt = prompt.trim();
    setSubmitError("");

    if (!user) {
      router.push("/login");
      return;
    }

    setIsSubmitting(true);

    try {
      const titleRes = await fetch("/api/projects/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      if (titleRes.status === 401) {
        router.push("/login");
        return;
      }

      if (!titleRes.ok) {
        throw new Error("项目命名失败，请稍后重试");
      }

      const titleJson = (await titleRes.json()) as { projectName?: string };
      const projectName = titleJson.projectName?.trim();

      if (!projectName) {
        throw new Error("项目命名失败，请稍后重试");
      }

      const createRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: projectName }),
      });

      if (createRes.status === 401) {
        router.push("/login");
        return;
      }

      if (!createRes.ok) {
        throw new Error("项目创建失败，请稍后重试");
      }

      const createJson = (await createRes.json()) as { project?: { id: string } };
      const projectId = createJson.project?.id;

      if (!projectId) {
        throw new Error("项目创建失败，请稍后重试");
      }

      router.push(
        `/workbench?project_id=${projectId}&prompt=${encodeURIComponent(trimmedPrompt)}&newProject=true`
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "启动项目失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, isSubmitting, prompt, router, user]);

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

      <main className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-4 pt-24 sm:px-6 sm:pt-32 lg:pt-36">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="flex w-full max-w-[760px] flex-col items-center"
        >
          <div className="mb-3 flex items-center justify-center">
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

          <h1 className="text-center text-[44px] font-semibold leading-[1.1] tracking-tight sm:text-[52px] lg:text-[60px]">
            把想法变成可销售的
            <span> 产品</span>
          </h1>

          <p className="mt-2 text-center text-[14px] opacity-70 sm:text-[16px] md:whitespace-nowrap">
            AI 员工用于验证想法、构建产品并获取客户。几分钟内完成。无需编码。
          </p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.45 }}
            className="mt-5 w-full max-w-[750px] rounded-[16px] border-border bg-background p-2.5 shadow-sm transition-all duration-300 hover:scale-[1.01] border "
          >
            <textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                if (submitError) {
                  setSubmitError("");
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="创建一个具有用户登录和数据库存储功能的SaaS订阅应用..."
              className="h-[80px] w-full resize-none rounded-xl border-0 bg-transparent p-2 text-[16px] text-foreground outline-none placeholder:text-foreground/40"
              disabled={isSubmitting}
            />

            <div className="mt-2 flex items-center justify-between px-1 pb-1">
              <button
                aria-label="上传附件"
                className="inline-flex size-7 items-center justify-center rounded-[8px] border border-foreground/10 bg-background text-foreground/60 transition-all duration-300 hover:scale-105 hover:bg-muted"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              </button>

              <button
                disabled={!canSubmit || isSubmitting}
                onClick={handleSubmit}
                className="inline-flex size-7 items-center justify-center rounded-[10px] transition-all duration-300 disabled:cursor-not-allowed disabled:bg-foreground/10 enabled:bg-foreground enabled:hover:scale-105 enabled:hover:bg-foreground/90 text-background"
                aria-label="发送"
              >
                {isSubmitting ? (
                  <Square className="size-5" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
                )}
              </button>
            </div>

            {submitError ? (
              <p className="px-2 pb-1 text-sm text-red-500">{submitError}</p>
            ) : null}
          </motion.div>
        </motion.section>

        </main>

        {user && projects.length > 0 && (
          <div className="mx-auto w-full max-w-[2000px] px-4 pb-14 sm:px-6">
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mt-48 w-full"
          >
            <div className="rounded-2xl bg-card border border-border shadow-sm px-8 py-6">
              <h2 className="text-lg font-semibold tracking-tight mb-6 text-card-foreground">我的项目</h2>

              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {projects.map((project, idx) => (
                  <motion.div
                    key={project.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.02, y: -3 }}
                    transition={{ delay: 0.05 * idx, duration: 0.3 }}
                    onClick={() => router.push(`/workbench?project_id=${project.id}`)}
                    className="group cursor-pointer rounded-xl p-2 -m-2 transition-colors hover:bg-muted/50"
                  >
                    {/* Thumbnail */}
                    <div className="relative aspect-video w-full rounded-xl bg-muted overflow-hidden mb-3 border border-border">
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/25 transition-transform duration-500 group-hover:scale-110">
                        <LayoutGrid className="size-10" />
                      </div>
                    </div>

                    {/* Info */}
                    <div className="flex items-center gap-2.5">
                      {/* Avatar */}
                      {profile?.avatar_url ? (
                        <div className="relative size-8 overflow-hidden rounded-full border border-border flex-shrink-0">
                          <Image
                            src={profile.avatar_url}
                            alt={profile.username || "Avatar"}
                            fill
                            sizes="32px"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div className="size-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold flex-shrink-0">
                          {(profile?.username || "U")[0].toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold line-clamp-1 text-foreground">{project.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(project.created_at), { addSuffix: true, locale: zhCN })}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.section>
          </div>
        )}
    </div>
  );
}

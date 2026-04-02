"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { User } from "@supabase/supabase-js";
import {
  Atom,
  PanelLeftClose,
  PanelLeft,
  Settings,
  LogOut,
  MessageSquare,
  MoreHorizontal,
} from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";
import { useHistoryStore } from "@/stores/historyStore";
import { SidebarProjectItem } from "@/components/SidebarProjectItem";

type UserProfile = {
  email: string | null;
  username: string | null;
  avatar_url: string | null;
};

export function SidebarAndHeader({
  user,
  profile,
  onSidebarChange,
}: {
  user: User | null;
  profile: UserProfile | null;
  onSidebarChange?: (pinned: boolean) => void;
}) {
  const [resolvedUser, setResolvedUser] = useState<User | null>(user);
  const [resolvedProfile, setResolvedProfile] =
    useState<UserProfile | null>(profile);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const { theme, setTheme } = useTheme();
  const { projects, isLoading, fetchProjects } = useHistoryStore();

  useEffect(() => {
    setResolvedUser(user);
  }, [user]);

  useEffect(() => {
    setResolvedProfile(profile);
  }, [profile]);

  useEffect(() => {
    if (resolvedUser?.id) {
      void fetchProjects(resolvedUser.id);
      return;
    }

    void fetchProjects("");
  }, [resolvedUser?.id, fetchProjects]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return;

    let cancelled = false;

    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("email, username, avatar_url")
        .eq("id", userId)
        .maybeSingle();

      if (!cancelled) {
        setResolvedProfile(data ?? null);
      }
    };

    const syncAuth = async () => {
      const {
        data: { user: nextUser },
      } = await supabase.auth.getUser();

      if (cancelled) return;
      setResolvedUser(nextUser ?? null);

      if (nextUser) {
        await loadProfile(nextUser.id);
      } else {
        setResolvedProfile(null);
      }
    };

    void syncAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setResolvedUser(nextUser);

      if (nextUser) {
        void loadProfile(nextUser.id);
      } else {
        setResolvedProfile(null);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setMounted(true);

    const pinned = localStorage.getItem("sidebarPinned") === "true";
    setIsPinned(pinned);
    onSidebarChange?.(pinned);
  }, [onSidebarChange]);

  const togglePinned = () => {
    const next = !isPinned;
    setIsPinned(next);
    localStorage.setItem("sidebarPinned", String(next));
    if (onSidebarChange) onSidebarChange(next);
  };

  const handleLogout = async () => {
    const supabase = getBrowserSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.location.href = "/login";
  };

  const profileEmail = resolvedProfile?.email ?? resolvedUser?.email ?? "";
  const profileName =
    resolvedProfile?.username?.trim() ||
    profileEmail.split("@")[0] ||
    "用户";
  const profileAvatarUrl = resolvedProfile?.avatar_url?.trim() || null;
  const avatarFallback = profileName[0]?.toUpperCase() || "U";

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [profileAvatarUrl]);

  const showSidebar = resolvedUser && (isPinned || isHovered);

  return (
    <>
      {resolvedUser && !isPinned && (
        <div
          className="fixed left-0 top-0 bottom-0 w-6 z-40"
          onMouseEnter={() => setIsHovered(true)}
        />
      )}

      <header
        className={`fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-4 sm:px-6 transition-all duration-300 z-30 ${isPinned && resolvedUser ? "pl-72" : ""}`}
      >
        <div className="flex items-center gap-4">
          {!resolvedUser || (!isPinned && !isHovered) ? (
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-full px-1 py-1.5"
            >
              <Atom className="size-5 text-foreground transition-transform duration-300 group-hover:scale-105" />
              <span className="text-[22px] font-semibold tracking-tight text-foreground">
                Vortex
              </span>
            </Link>
          ) : null}

          {resolvedUser && !isPinned && !isHovered && (
            <button
              onMouseEnter={() => setIsHovered(true)}
              className="opacity-40 hover:opacity-100 transition-opacity p-2 -ml-2 select-none flex items-center justify-center cursor-pointer"
              aria-label="打开侧边栏"
            >
              <PanelLeft className="size-4.5" />
            </button>
          )}
        </div>

        {!resolvedUser && (
          <div className="flex items-center gap-2 text-sm z-50">
            <Link
              href="/login"
              className="rounded-full border border-border bg-muted px-4 py-1.5 font-medium text-black/85 dark:text-white/85 transition-all duration-300 hover:scale-105 hover:bg-black/5 dark:hover:bg-white/5"
            >
              登录
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground transition-all duration-300 hover:scale-105 hover:bg-primary/90"
            >
              注册
            </Link>
          </div>
        )}
      </header>

      {/* Sidebar background overlay for mobile/hover only */}
      <AnimatePresence>
        {isHovered && !isPinned && resolvedUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            onClick={() => setIsHovered(false)}
          />
        )}
      </AnimatePresence>

      {resolvedUser && (
        <motion.aside
          initial={{ x: "-100%" }}
          animate={{ x: showSidebar ? 0 : "-100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          onMouseLeave={() => !isPinned && setIsHovered(false)}
          className={`fixed top-0 left-0 bottom-0 w-64 bg-muted border-r border-border z-50 flex flex-col`}
        >
          <div className="flex items-center justify-between h-16 px-4">
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-full px-1 py-1.5 overflow-hidden"
              onClick={() => {
                if (!isPinned) setIsHovered(false);
              }}
            >
              <Atom className="size-5 text-foreground transition-transform duration-300 group-hover:scale-105 flex-shrink-0" />
              <span className="text-[18px] font-semibold tracking-tight text-foreground truncate">
                Vortex
              </span>
            </Link>

            <div className="flex items-center gap-1 group">
              <button
                onClick={togglePinned}
                className="p-1.5 text-foreground/40 hover:text-foreground/80 hover:bg-foreground/5 rounded-md transition-colors"
                aria-label={isPinned ? "取消固定侧边栏" : "固定侧边栏"}
              >
                {isPinned ? (
                  <PanelLeftClose className="size-4.5" />
                ) : (
                  <PanelLeft className="size-4.5" />
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            <div className="text-xs font-semibold text-foreground/40 px-2 pt-2 pb-2">
              最近的项目
            </div>
            {isLoading ? (
              <div className="px-2 py-2 text-sm text-foreground/45">
                正在加载项目...
              </div>
            ) : projects.length > 0 ? (
              projects.slice(0, 8).map((project) => (
                <SidebarProjectItem key={project.id} project={project} />
              ))
            ) : (
              <div className="flex items-center gap-2.5 px-2 py-2 text-sm text-foreground/45">
                <MessageSquare className="size-4 opacity-60" />
                <span className="truncate">还没有历史项目</span>
              </div>
            )}
          </div>

          {/* Bottom user card */}
          <div className="p-3 border-t border-border relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-foreground/5 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                {profileAvatarUrl && !avatarLoadFailed ? (
                  <div className="relative size-8 flex-shrink-0 overflow-hidden rounded-full shadow-sm">
                    <Image
                      src={profileAvatarUrl}
                      alt={profileName}
                      fill
                      sizes="32px"
                      onError={() => setAvatarLoadFailed(true)}
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="size-8 rounded-full bg-black flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                    {avatarFallback}
                  </div>
                )}
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-foreground/85 truncate leading-tight">
                    {profileName}
                  </span>
                  <span className="text-[11px] text-foreground/40 truncate leading-tight mt-0.5">
                    Free Plan
                  </span>
                </div>
              </div>
              <MoreHorizontal className="size-4 text-foreground/40 flex-shrink-0" />
            </button>

            <div className="px-2 mt-3 mb-1">
              <div className="flex items-center justify-between text-[11px] text-foreground/50 mb-1.5 font-medium">
                <span>额度</span>
                <span>500 / 500</span>
              </div>
              <div className="h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary w-full rounded-full" />
              </div>
            </div>

            <AnimatePresence>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full left-3 mb-2 w-[240px] bg-background rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] border border-foreground/5 z-50 p-2 overflow-hidden flex flex-col"
                  >
                    <div className="px-3 pt-2 pb-3 mb-1 border-b border-foreground/5 flex flex-col">
                      <span className="text-sm font-medium text-foreground/90 truncate">
                        {profileName}
                      </span>
                      <span className="text-xs text-foreground/40 truncate mt-0.5">
                        {profileEmail}
                      </span>
                    </div>

                    <div className="px-2 mb-2 mt-1">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/50 py-1.5">
                        <Settings className="size-3.5" />
                        外观主题
                      </div>
                      {mounted && (
                        <div className="grid grid-cols-3 gap-1 mt-1 bg-foreground/5 p-1 rounded-lg">
                          <button
                            onClick={() => setTheme("system")}
                            className={`text-xs py-1 rounded-md transition-colors ${theme === "system" ? "bg-background shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-foreground font-medium" : "text-foreground/60 hover:text-foreground"}`}
                          >
                            系统
                          </button>
                          <button
                            onClick={() => setTheme("light")}
                            className={`text-xs py-1 rounded-md transition-colors ${theme === "light" ? "bg-background shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-foreground font-medium" : "text-foreground/60 hover:text-foreground"}`}
                          >
                            浅色
                          </button>
                          <button
                            onClick={() => setTheme("dark")}
                            className={`text-xs py-1 rounded-md transition-colors ${theme === "dark" ? "bg-background shadow-[0_1px_2px_rgba(0,0,0,0.1)] text-foreground font-medium" : "text-foreground/60 hover:text-foreground"}`}
                          >
                            深色
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#d04550] hover:bg-[#d04550]/10 rounded-lg transition-colors font-medium"
                    >
                      <LogOut className="size-4" />
                      退出登录
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </motion.aside>
      )}
    </>
  );
}

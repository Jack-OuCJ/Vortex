"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
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

export function SidebarAndHeader({
  user,
  onSidebarChange,
}: {
  user: User | null;
  onSidebarChange?: (pinned: boolean) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // Avoid synchronous setState in effect
    setTimeout(() => {
      setMounted(true);
      const pinned = localStorage.getItem("sidebarPinned") === "true";
      setIsPinned(pinned);
      if (onSidebarChange) onSidebarChange(pinned);
    }, 0);
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

  const showSidebar = user && (isPinned || isHovered);

  return (
    <>
      {user && !isPinned && (
        <div
          className="fixed left-0 top-0 bottom-0 w-6 z-40"
          onMouseEnter={() => setIsHovered(true)}
        />
      )}

      <header
        className={`fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-4 sm:px-6 transition-all duration-300 z-30 ${isPinned && user ? "pl-72" : ""}`}
      >
        <div className="flex items-center gap-4">
          {!user || (!isPinned && !isHovered) ? (
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-full px-1 py-1.5"
            >
              <Atom className="size-5 text-[#1b1b1d] dark:text-[#ededef] transition-transform duration-300 group-hover:scale-105" />
              <span className="text-[22px] font-semibold tracking-tight text-foreground">
                Atoms
              </span>
            </Link>
          ) : null}

          {user && !isPinned && !isHovered && (
            <button
              onMouseEnter={() => setIsHovered(true)}
              className="opacity-40 hover:opacity-100 transition-opacity p-2 -ml-2 select-none flex items-center justify-center cursor-pointer"
              aria-label="打开侧边栏"
            >
              <div className="w-1.5 h-6 bg-foreground/20 rounded-full" />
            </button>
          )}
        </div>

        {!user && (
          <div className="flex items-center gap-2 text-sm z-50">
            <Link
              href="/login"
              className="rounded-full border border-black/5 dark:border-white/10 bg-[#ececec] dark:bg-[#2a2a2c] px-4 py-1.5 font-medium text-black/85 dark:text-white/85 transition-all duration-300 hover:scale-105 hover:bg-[#e2e2e2] dark:hover:bg-[#333]"
            >
              登录
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-[#3f64ff] px-4 py-1.5 font-medium text-white transition-all duration-300 hover:scale-105 hover:bg-[#3558eb]"
            >
              注册
            </Link>
          </div>
        )}
      </header>

      {/* Sidebar background overlay for mobile/hover only */}
      <AnimatePresence>
        {isHovered && !isPinned && user && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/5 dark:bg-black/20 z-40"
            onClick={() => setIsHovered(false)}
          />
        )}
      </AnimatePresence>

      {user && (
        <motion.aside
          initial={{ x: "-100%" }}
          animate={{ x: showSidebar ? 0 : "-100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          onMouseLeave={() => !isPinned && setIsHovered(false)}
          className={`fixed top-0 left-0 bottom-0 w-64 bg-[#f9f9f9] dark:bg-[#111113] border-r border-black/5 dark:border-white/5 z-50 flex flex-col`}
        >
          <div className="flex items-center justify-between h-16 px-4">
            <Link
              href="/"
              className="group inline-flex items-center gap-2 rounded-full px-1 py-1.5 overflow-hidden"
              onClick={() => {
                if (!isPinned) setIsHovered(false);
              }}
            >
              <Atom className="size-5 text-[#1b1b1d] dark:text-[#ededef] transition-transform duration-300 group-hover:scale-105 flex-shrink-0" />
              <span className="text-[18px] font-semibold tracking-tight text-foreground truncate">
                Atoms
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
            <button className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-foreground/5 text-sm text-foreground/75 transition-colors">
              <MessageSquare className="size-4 opacity-70" />
              <span className="truncate">SaaS 登录系统</span>
            </button>
            <button className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-foreground/5 text-sm text-foreground/75 transition-colors">
              <MessageSquare className="size-4 opacity-70" />
              <span className="truncate">电商后台大屏</span>
            </button>
          </div>

          {/* Bottom user card */}
          <div className="p-3 border-t border-black/5 dark:border-white/5 relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-foreground/5 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="size-8 rounded-full bg-gradient-to-tr from-[#3f64ff] to-[#ffb06f] flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                  {user.email?.[0].toUpperCase()}
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-sm font-medium text-foreground/85 truncate leading-tight">
                    {user.email?.split("@")[0]}
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
                <div className="h-full bg-[#3f64ff] w-full rounded-full" />
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
                        {user.email?.split("@")[0]}
                      </span>
                      <span className="text-xs text-foreground/40 truncate mt-0.5">
                        {user.email}
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
                            className={`text-xs py-1 rounded-md transition-colors ${theme === "dark" ? "bg-[#333] shadow-[0_1px_2px_rgba(0,0,0,0.2)] text-white font-medium" : "text-foreground/60 hover:text-foreground"}`}
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

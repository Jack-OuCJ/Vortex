"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Circle,
  FilePenLine,
  FolderOpen,
  ImageIcon,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { formatWorkflowToolTitle, stripWorkflowPathDecorations, type WorkflowStep } from "@/lib/workflow";

const getStepIcon = (step: WorkflowStep): LucideIcon => {
  if (step.source === "tool") {
    if (step.toolName === "wc.fs.readFile" || step.toolName === "wc.fs.writeFile") {
      return FilePenLine;
    }

    if (step.toolName === "wc.fs.readdir" || step.toolName === "wc.fs.mkdir" || step.toolName === "wc.fs.rm") {
      return FolderOpen;
    }

    if (step.toolName === "wc.spawn" || step.toolName === "wc.readProcess" || step.toolName === "wc.killProcess") {
      return Terminal;
    }

    return Wrench;
  }

  if (`${step.title} ${step.detail ?? ""}`.match(/图像|图片|image/i)) {
    return ImageIcon;
  }

  return Brain;
};

export function WorkflowAccordion({ steps }: { steps: WorkflowStep[] }) {
  const hasRunning = steps.some((step) => step.status === "running");
  const [manualOpen, setManualOpen] = useState(false);
  const [hasManualToggle, setHasManualToggle] = useState(false);
  const isOpen = hasRunning || (hasManualToggle ? manualOpen : false);

  if (!steps.length) {
    return null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-border/70 bg-background/85 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        onClick={() => {
          const nextOpen = !isOpen;
          setHasManualToggle(true);
          setManualOpen(nextOpen);
        }}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <span className="flex items-center gap-2 text-[15px] text-foreground/85">
          <Brain className="h-3.5 w-3.5 text-foreground/55" />
          <span>工作流程</span>
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-foreground/55" />
        ) : (
          <ChevronDown className="h-4 w-4 text-foreground/55" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">
              {steps.map((step, index) => {
                const Icon = getStepIcon(step);
                const rawTitle = step.source === "tool" && step.toolName
                  ? formatWorkflowToolTitle(step.toolName)
                  : step.title;
                const displayTitle = stripWorkflowPathDecorations(rawTitle);
                const displayDetail = stripWorkflowPathDecorations(step.detail);

                return (
                  <div key={step.id} className="flex gap-3">
                    <div className="flex w-4 flex-col items-center pt-1.5">
                      <Circle className="h-2 w-2 fill-current text-border" />
                      {index < steps.length - 1 ? <div className="mt-1 h-full w-px bg-border/60" /> : null}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13px] text-foreground/85">
                            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/55" />
                              <span className="truncate">{displayTitle}</span>
                          </div>
                          {displayDetail ? (
                            <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-6 text-muted-foreground">
                              {displayDetail}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
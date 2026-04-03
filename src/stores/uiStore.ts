import { create } from "zustand";
import type { WorkflowStep, WorkflowStepStatus, WorkflowToolName } from "@/lib/workflow";

const HIDDEN_STEP_IDS = new Set<string>([]);
const HIDDEN_STEP_TITLES = new Set<string>([]);

type ExpandedDirectories = Record<string, true>;

type UiStore = {
  activeTab: "preview" | "code";
  sidebarWidth: number;
  currentRound: number;
  steps: WorkflowStep[];
  expandedDirectories: ExpandedDirectories;
  setActiveTab: (tab: "preview" | "code") => void;
  setSidebarWidth: (sidebarWidth: number) => void;
  toggleDirectory: (path: string) => void;
  expandDirectories: (paths: string[]) => void;
  resetSteps: () => void;
  upsertStep: (step: {
    id: string;
    title: string;
    status: WorkflowStepStatus;
    detail?: string;
    source?: "step" | "tool";
    toolName?: WorkflowToolName;
  }) => void;
};

export const useUiStore = create<UiStore>((set) => ({
  activeTab: "preview",
  sidebarWidth: 25,
  currentRound: 0,
  steps: [],
  expandedDirectories: {},
  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  toggleDirectory: (path) =>
    set((state) => {
      if (state.expandedDirectories[path]) {
        const next = { ...state.expandedDirectories };
        delete next[path];
        return { expandedDirectories: next };
      }

      return {
        expandedDirectories: {
          ...state.expandedDirectories,
          [path]: true,
        },
      };
    }),
  expandDirectories: (paths) =>
    set((state) => {
      if (!paths.length) {
        return state;
      }

      let changed = false;
      const next = { ...state.expandedDirectories };

      paths.forEach((path) => {
        if (!path || next[path]) {
          return;
        }

        next[path] = true;
        changed = true;
      });

      return changed ? { expandedDirectories: next } : state;
    }),
  resetSteps: () =>
    set((state) => ({
      currentRound: state.currentRound + 1,
      steps: [],
    })),
  upsertStep: (step) =>
    set((state) => {
      if (HIDDEN_STEP_IDS.has(step.id) || HIDDEN_STEP_TITLES.has(step.title)) {
        return state;
      }

      const next = [...state.steps];
      const idx = next.findIndex((item) => item.id === step.id);
      const payload = {
        ...step,
        updatedAt: Date.now(),
        round: state.currentRound,
        source: step.source ?? "step",
      };

      if (idx === -1) {
        next.push(payload);
      } else {
        next[idx] = {
          ...next[idx],
          ...payload,
        };
      }

      return { steps: next };
    }),
}));

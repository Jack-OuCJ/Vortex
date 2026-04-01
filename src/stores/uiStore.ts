import { create } from "zustand";
import type { WorkflowStep, WorkflowStepStatus, WorkflowToolName } from "@/lib/workflow";

const HIDDEN_STEP_IDS = new Set<string>([]);
const HIDDEN_STEP_TITLES = new Set<string>([]);

type UiStore = {
  activeTab: "preview" | "code";
  sidebarWidth: number;
  currentRound: number;
  steps: WorkflowStep[];
  setActiveTab: (tab: "preview" | "code") => void;
  setSidebarWidth: (sidebarWidth: number) => void;
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
  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
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

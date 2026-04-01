import { create } from "zustand";

export type ProjectMeta = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type HistoryStore = {
  projects: ProjectMeta[];
  isLoading: boolean;
  fetchProjects: (userId: string) => Promise<void>;
  updateProjectName: (projectId: string, newName: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
};

export const useHistoryStore = create<HistoryStore>((set) => ({
  projects: [],
  isLoading: false,

  fetchProjects: async (userId: string) => {
    if (!userId) {
      set({ projects: [], isLoading: false });
      return;
    }
    set({ isLoading: true });
    try {
      const response = await fetch("/api/projects", { method: "GET" });
      const payload = (await response.json().catch(() => null)) as
        | { projects?: ProjectMeta[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to fetch historical projects");
      }

      set({ projects: payload?.projects ?? [] });
    } catch (err) {
      console.error("Failed to fetch historical projects:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  updateProjectName: async (projectId: string, newName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { project?: ProjectMeta; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to rename project");
      }

      const updatedProject = payload?.project;
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId ? updatedProject ?? { ...p, name: newName } : p
        ),
      }));
    } catch (err) {
      console.error("Failed to rename project:", err);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to delete project");
      }

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== projectId),
      }));
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  },
}));

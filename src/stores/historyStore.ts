import { create } from "zustand";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

export type ProjectMeta = {
  id: string;
  name: string;
  user_id: string;
  is_public: boolean;
  share_token: string;
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

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  projects: [],
  isLoading: false,

  fetchProjects: async (userId: string) => {
    if (!userId) return;
    set({ isLoading: true });
    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) return;
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      set({ projects: data as ProjectMeta[] });
    } catch (err) {
      console.error("Failed to fetch historical projects:", err);
    } finally {
      set({ isLoading: false });
    }
  },

  updateProjectName: async (projectId: string, newName: string) => {
    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase
        .from("projects")
        .update({ name: newName })
        .eq("id", projectId);

      if (error) throw error;
      set((state) => ({
        projects: state.projects.map((p) =>
          p.id === projectId ? { ...p, name: newName } : p
        ),
      }));
    } catch (err) {
      console.error("Failed to rename project:", err);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId);

      if (error) throw error;
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== projectId),
      }));
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  },
}));

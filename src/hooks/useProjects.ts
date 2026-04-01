import { useState, useCallback, useEffect } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

export type Project = {
  id: string;
  name: string;
  created_at: string;
  user_id: string;
  share_token: string;
  is_public: boolean;
};

export function useProjects(userId: string | undefined | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    if (!userId) {
      setProjects([]);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) throw new Error("Supabase client not available");
      
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, created_at, user_id, share_token, is_public")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
        
      if (error) throw error;
      setProjects(data || []);
    } catch (err: any) {
      console.error("Error fetching projects:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const updateProjectName = async (projectId: string, newName: string) => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return false;
    
    try {
      const { error } = await supabase
        .from("projects")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", projectId)
        .eq("user_id", userId);
        
      if (error) throw error;
      
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, name: newName } : p));
      return true;
    } catch (err) {
      console.error("Error updating project:", err);
      return false;
    }
  };

  const deleteProject = async (projectId: string) => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return false;
    
    try {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", userId);
        
      if (error) throw error;
      
      setProjects(prev => prev.filter(p => p.id !== projectId));
      return true;
    } catch (err) {
      console.error("Error deleting project:", err);
      return false;
    }
  };

  return {
    projects,
    isLoading,
    error,
    refetch: fetchProjects,
    updateProjectName,
    deleteProject
  };
}

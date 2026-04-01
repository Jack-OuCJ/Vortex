import { useState, useCallback, useEffect } from "react";

export type Project = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
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
      const response = await fetch("/api/projects", { method: "GET" });
      const payload = (await response.json().catch(() => null)) as
        | { projects?: Project[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to fetch projects");
      }

      setProjects(payload?.projects ?? []);
    } catch (err: unknown) {
      console.error("Error fetching projects:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch projects");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const updateProjectName = async (projectId: string, newName: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { project?: Project; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update project");
      }

      const updatedProject = payload?.project;
      
      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? updatedProject ?? { ...project, name: newName } : project
        )
      );
      return true;
    } catch (err: unknown) {
      console.error("Error updating project:", err);
      return false;
    }
  };

  const deleteProject = async (projectId: string) => {
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
      
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      return true;
    } catch (err: unknown) {
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
    deleteProject,
  };
}

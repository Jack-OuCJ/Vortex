import { create } from "zustand";

type ProjectFiles = Record<string, string>;
type FileTimestamps = Record<string, string | null>;

export type ConflictCandidate = {
  path: string;
  localContent: string;
  serverContent: string;
  mergedContent: string;
  serverUpdatedAt: string;
};

type ConflictCandidates = Record<string, ConflictCandidate>;

const DEFAULT_FILES: ProjectFiles = {
  "/App.tsx": `export default function App() {
  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <h1>Hello from Atom's Multi-Agent Demo</h1>
      <p>This is a live preview of your generated app.</p>
    </div>
  )
}`,
};

type ProjectStore = {
  projectId: string | null;
  projectName: string;
  sessionId: string | null;
  isBootstrapping: boolean;
  files: ProjectFiles;
  fileTimestamps: FileTimestamps;
  conflictCandidates: ConflictCandidates;
  activeFilePath: string;
  setProjectMeta: (id: string, name: string) => void;
  setSessionId: (sessionId: string | null) => void;
  setIsBootstrapping: (isBootstrapping: boolean) => void;
  setFiles: (files: ProjectFiles) => void;
  setRemoteFiles: (files: Array<{ path: string; content: string; updated_at?: string | null }>) => void;
  upsertFiles: (files: Array<{ path: string; code: string }>) => void;
  setFileTimestamps: (rows: Array<{ path: string; updated_at: string }>) => void;
  upsertConflictCandidates: (candidates: ConflictCandidate[]) => void;
  clearConflictCandidate: (path: string) => void;
  updateActiveFile: (path: string, code: string) => void;
  setActiveFilePath: (path: string) => void;
};

export const useProjectStore = create<ProjectStore>((set) => ({
  projectId: null,
  projectName: "Untitled Project",
  sessionId: null,
  isBootstrapping: true,
  files: DEFAULT_FILES,
  fileTimestamps: {},
  conflictCandidates: {},
  activeFilePath: "/App.tsx",
  setProjectMeta: (id, name) => set({ projectId: id, projectName: name }),
  setSessionId: (sessionId) => set({ sessionId }),
  setIsBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setFiles: (files) =>
    set((state) => {
      const paths = Object.keys(files);
      const fallbackPath = paths[0] ?? "/App.tsx";
      const nextActive = files[state.activeFilePath] ? state.activeFilePath : fallbackPath;
      return {
        files,
        activeFilePath: nextActive,
      };
    }),
  setRemoteFiles: (rows) =>
    set((state) => {
      const nextFiles: ProjectFiles = {};
      const nextTimestamps: FileTimestamps = {};

      if (!rows.length) {
        Object.entries(DEFAULT_FILES).forEach(([path, content]) => {
          nextFiles[path] = content;
          nextTimestamps[path] = null;
        });
      } else {
        rows.forEach((file) => {
          nextFiles[file.path] = file.content;
          nextTimestamps[file.path] = file.updated_at ?? null;
        });
      }

      const paths = Object.keys(nextFiles);
      const fallbackPath = paths[0] ?? "/App.tsx";
      const nextActive = nextFiles[state.activeFilePath] ? state.activeFilePath : fallbackPath;

      return {
        files: nextFiles,
        fileTimestamps: nextTimestamps,
        activeFilePath: nextActive,
      };
    }),
  upsertFiles: (incoming) =>
    set((state) => {
      const nextFiles = { ...state.files };
      for (const file of incoming) {
        nextFiles[file.path] = file.code;
      }
      return { files: nextFiles };
    }),
  setFileTimestamps: (rows) =>
    set((state) => {
      if (!rows.length) {
        return state;
      }

      const nextTimestamps = { ...state.fileTimestamps };
      rows.forEach((row) => {
        nextTimestamps[row.path] = row.updated_at;
      });

      return {
        fileTimestamps: nextTimestamps,
      };
    }),
  upsertConflictCandidates: (candidates) =>
    set((state) => {
      if (!candidates.length) return state;

      const next = { ...state.conflictCandidates };
      candidates.forEach((candidate) => {
        next[candidate.path] = candidate;
      });

      return {
        conflictCandidates: next,
      };
    }),
  clearConflictCandidate: (path) =>
    set((state) => {
      if (!state.conflictCandidates[path]) return state;
      const next = { ...state.conflictCandidates };
      delete next[path];
      return { conflictCandidates: next };
    }),
  updateActiveFile: (path, code) =>
    set((state) => ({
      files: {
        ...state.files,
        [path]: code,
      },
    })),
  setActiveFilePath: (path) => set({ activeFilePath: path }),
}));

export const normalizeRemoteFiles = (
  files: Array<{ path: string; content: string }>
): ProjectFiles => {
  if (!files.length) {
    return DEFAULT_FILES;
  }

  return files.reduce<ProjectFiles>((acc, file) => {
    acc[file.path] = file.content;
    return acc;
  }, {});
};

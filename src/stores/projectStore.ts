import { create } from "zustand";
import { canonicalizeLogicalPath, getPersistedTemplateFiles } from "@/lib/webcontainer-template";

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

const normalizeProjectFilesMap = (files: ProjectFiles): ProjectFiles => {
  return Object.entries(files).reduce<ProjectFiles>((acc, [path, content]) => {
    acc[canonicalizeLogicalPath(path)] = content;
    return acc;
  }, {});
};

const normalizeFileTimestamps = (rows: Array<{ path: string; updated_at: string | null }>): FileTimestamps => {
  return rows.reduce<FileTimestamps>((acc, row) => {
    acc[canonicalizeLogicalPath(row.path)] = row.updated_at;
    return acc;
  }, {});
};

const DEFAULT_FILES: ProjectFiles = getPersistedTemplateFiles();
const DEFAULT_ACTIVE_FILE_PATH = "/src/App.tsx";

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
  setProjectName: (name: string) => void;
  setSessionId: (sessionId: string | null) => void;
  setIsBootstrapping: (isBootstrapping: boolean) => void;
  setFiles: (files: ProjectFiles) => void;
  setRemoteFiles: (files: Array<{ path: string; content: string; updated_at?: string | null }>) => void;
  upsertFiles: (files: Array<{ path: string; code: string }>) => void;
  removeFiles: (paths: string[]) => void;
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
  activeFilePath: DEFAULT_ACTIVE_FILE_PATH,
  setProjectMeta: (id, name) => set({ projectId: id, projectName: name }),
  setProjectName: (name) => set({ projectName: name }),
  setSessionId: (sessionId) => set({ sessionId }),
  setIsBootstrapping: (isBootstrapping) => set({ isBootstrapping }),
  setFiles: (files) =>
    set((state) => {
      const normalizedFiles = normalizeProjectFilesMap(files);
      const paths = Object.keys(normalizedFiles);
      const currentActivePath = canonicalizeLogicalPath(state.activeFilePath);
      const fallbackPath = normalizedFiles[DEFAULT_ACTIVE_FILE_PATH]
        ? DEFAULT_ACTIVE_FILE_PATH
        : paths[0] ?? DEFAULT_ACTIVE_FILE_PATH;
      const nextActive = normalizedFiles[currentActivePath] ? currentActivePath : fallbackPath;
      return {
        files: normalizedFiles,
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
          const normalizedPath = canonicalizeLogicalPath(file.path);
          nextFiles[normalizedPath] = file.content;
          nextTimestamps[normalizedPath] = file.updated_at ?? null;
        });
      }

      const paths = Object.keys(nextFiles);
      const currentActivePath = canonicalizeLogicalPath(state.activeFilePath);
      const fallbackPath = nextFiles[DEFAULT_ACTIVE_FILE_PATH]
        ? DEFAULT_ACTIVE_FILE_PATH
        : paths[0] ?? DEFAULT_ACTIVE_FILE_PATH;
      const nextActive = nextFiles[currentActivePath] ? currentActivePath : fallbackPath;

      return {
        files: nextFiles,
        fileTimestamps: nextTimestamps,
        conflictCandidates: {},
        activeFilePath: nextActive,
      };
    }),
  upsertFiles: (incoming) =>
    set((state) => {
      const nextFiles = { ...state.files };
      for (const file of incoming) {
        nextFiles[canonicalizeLogicalPath(file.path)] = file.code;
      }
      return { files: nextFiles };
    }),
  removeFiles: (paths) =>
    set((state) => {
      if (!paths.length) {
        return state;
      }

      const nextFiles = { ...state.files };
      const nextTimestamps = { ...state.fileTimestamps };
      const nextConflicts = { ...state.conflictCandidates };

      paths.forEach((path) => {
        const normalizedPath = canonicalizeLogicalPath(path);
        delete nextFiles[normalizedPath];
        delete nextTimestamps[normalizedPath];
        delete nextConflicts[normalizedPath];
      });

      const remainingPaths = Object.keys(nextFiles);
      const currentActivePath = canonicalizeLogicalPath(state.activeFilePath);
      const fallbackPath = nextFiles[DEFAULT_ACTIVE_FILE_PATH]
        ? DEFAULT_ACTIVE_FILE_PATH
        : remainingPaths[0] ?? DEFAULT_ACTIVE_FILE_PATH;

      return {
        files: nextFiles,
        fileTimestamps: nextTimestamps,
        conflictCandidates: nextConflicts,
        activeFilePath: nextFiles[currentActivePath] ? currentActivePath : fallbackPath,
      };
    }),
  setFileTimestamps: (rows) =>
    set((state) => {
      if (!rows.length) {
        return state;
      }

      const nextTimestamps = {
        ...state.fileTimestamps,
        ...normalizeFileTimestamps(rows),
      };

      return {
        fileTimestamps: nextTimestamps,
      };
    }),
  upsertConflictCandidates: (candidates) =>
    set((state) => {
      if (!candidates.length) return state;

      const next = { ...state.conflictCandidates };
      candidates.forEach((candidate) => {
        const normalizedPath = canonicalizeLogicalPath(candidate.path);
        next[normalizedPath] = {
          ...candidate,
          path: normalizedPath,
        };
      });

      return {
        conflictCandidates: next,
      };
    }),
  clearConflictCandidate: (path) =>
    set((state) => {
      const normalizedPath = canonicalizeLogicalPath(path);
      if (!state.conflictCandidates[normalizedPath]) return state;
      const next = { ...state.conflictCandidates };
      delete next[normalizedPath];
      return { conflictCandidates: next };
    }),
  updateActiveFile: (path, code) =>
    set((state) => ({
      files: {
        ...state.files,
        [canonicalizeLogicalPath(path)]: code,
      },
    })),
  setActiveFilePath: (path) => set({ activeFilePath: canonicalizeLogicalPath(path) }),
}));

export const normalizeRemoteFiles = (
  files: Array<{ path: string; content: string }>
): ProjectFiles => {
  if (!files.length) {
    return { ...DEFAULT_FILES };
  }

  return files.reduce<ProjectFiles>((acc, file) => {
    acc[canonicalizeLogicalPath(file.path)] = file.content;
    return acc;
  }, {});
};

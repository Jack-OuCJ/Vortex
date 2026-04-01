"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import { getWebContainer } from "@/lib/webcontainer-singleton";
import {
  toDirectoryPath,
  toLogicalPath,
  toRuntimePath,
  toRuntimeTree,
} from "@/lib/webcontainer-template";

type FilesMap = Record<string, string>;

type ProcessSnapshot = {
  procId: string;
  output: string;
  completed: boolean;
  exitCode: number | null;
};

type ManagedProcess = {
  process: WebContainerProcess;
  output: string[];
  completed: boolean;
  exitCode: number | null;
};

// Strip ANSI/control sequences so terminal logs render as readable plain text.
const ANSI_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const stripTerminalControlCodes = (input: string): string => {
  let output = input.replace(ANSI_PATTERN, "");

  // Handle carriage-return spinner updates by keeping only the latest frame content.
  output = output
    .split("\r")
    .map((segment) => segment.replace(CONTROL_PATTERN, ""))
    .filter((segment) => segment.trim().length > 0)
    .join("\n");

  return output;
};

export function useWebContainer() {
  const [isReady, setIsReady] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const wcRef = useRef<WebContainer | null>(null);
  const startedRef = useRef(false);
  const startingRef = useRef<Promise<void> | null>(null);
  const syncedFilesRef = useRef<FilesMap>({});
  const logBufferRef = useRef("");
  const processCounterRef = useRef(0);
  const processesRef = useRef<Map<string, ManagedProcess>>(new Map());

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        // 使用单例：多次挂载组件时 boot 只发生一次
        const wc = await getWebContainer();
        if (!mounted) return;

        wcRef.current = wc;
        wc.on("server-ready", (_port, url) => {
          setServerUrl(url);
        });
        setIsReady(true);
      } catch (error) {
        if (mounted) {
          setLogs((prev) => [...prev, `WebContainer boot failed: ${String(error)}`]);
        }
      }
    };

    void boot();

    return () => {
      mounted = false;
      // 不调用 teardown()：单例必须常驻，teardown 会销毁全局实例
      wcRef.current = null;
    };
  }, []);

  const appendLog = useCallback((chunk: string | Uint8Array) => {
    const raw = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const sanitized = stripTerminalControlCodes(raw);
    if (!sanitized) {
      return;
    }

    const combined = `${logBufferRef.current}${sanitized}`;
    const lines = combined.split("\n");
    const nextBuffer = lines.pop() ?? "";
    logBufferRef.current = nextBuffer;

    const finalized = lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);
    if (finalized.length > 0) {
      setLogs((prev) => [...prev, ...finalized].slice(-200));
    }
  }, []);

  const registerProcess = useCallback((process: WebContainerProcess, initialLine: string) => {
    const procId = `proc:${++processCounterRef.current}`;
    const managed: ManagedProcess = {
      process,
      output: initialLine ? [initialLine] : [],
      completed: false,
      exitCode: null,
    };

    processesRef.current.set(procId, managed);

    void process.output.pipeTo(
      new WritableStream({
        write(data) {
          const raw = typeof data === "string" ? data : new TextDecoder().decode(data);
          const sanitized = stripTerminalControlCodes(raw);
          if (!sanitized) {
            return;
          }

          const current = processesRef.current.get(procId);
          if (!current) {
            return;
          }

          current.output.push(sanitized);
          if (current.output.length > 200) {
            current.output = current.output.slice(-200);
          }
          appendLog(sanitized);
        },
      })
    );

    void process.exit.then((exitCode) => {
      const current = processesRef.current.get(procId);
      if (!current) {
        return;
      }

      current.completed = true;
      current.exitCode = exitCode;
    });

    return procId;
  }, [appendLog]);

  const ensureStarted = useCallback(async () => {
    const wc = wcRef.current;
    if (!wc || !isReady) {
      throw new Error("WebContainer 尚未就绪");
    }

    if (startedRef.current) {
      return wc;
    }

    if (!startingRef.current) {
      startingRef.current = (async () => {
        const tree = toRuntimeTree(syncedFilesRef.current);
        await wc.mount(tree);

        appendLog("[runtime] Installing dependencies...");
        const installProc = await wc.spawn("npm", ["install"]);
        void installProc.output.pipeTo(
          new WritableStream({
            write(data) {
              appendLog(data);
            },
          })
        );
        const installExit = await installProc.exit;
        if (installExit !== 0) {
          throw new Error(`npm install failed with exit code ${installExit}`);
        }

        appendLog("[runtime] Starting dev server...");
        const devProc = await wc.spawn("npm", ["run", "dev"]);
        registerProcess(devProc, "[runtime] npm run dev started");

        startedRef.current = true;
      })()
        .catch((error) => {
          appendLog(`[runtime] Startup failed: ${String(error)}`);
          startedRef.current = false;
          throw error;
        })
        .finally(() => {
          startingRef.current = null;
        });
    }

    await startingRef.current;
    return wc;
  }, [appendLog, isReady, registerProcess]);

  const getProcessSnapshot = useCallback((procId: string): ProcessSnapshot | null => {
    const managed = processesRef.current.get(procId);
    if (!managed) {
      return null;
    }

    return {
      procId,
      output: managed.output.join("\n").trim(),
      completed: managed.completed,
      exitCode: managed.exitCode,
    };
  }, []);

  const syncFiles = useCallback(
    async (files: FilesMap) => {
      const wc = wcRef.current;
      if (!wc || !isReady) {
        return;
      }

      if (!startedRef.current) {
        syncedFilesRef.current = { ...files };
        await ensureStarted();
        syncedFilesRef.current = { ...files };
        return;
      }

      const previous = syncedFilesRef.current;
      const changedEntries = Object.entries(files).filter(
        ([logicalPath, content]) => previous[logicalPath] !== content
      );
      const removedPaths = Object.keys(previous).filter(
        (logicalPath) => !(logicalPath in files)
      );

      if (!changedEntries.length && !removedPaths.length) {
        return;
      }

      await Promise.all(
        [
          ...changedEntries.map(async ([logicalPath, content]) => {
            const runtimePath = toRuntimePath(logicalPath);
            const dirPath = toDirectoryPath(runtimePath);
            if (dirPath) {
              await wc.fs.mkdir(dirPath, { recursive: true });
            }
            await wc.fs.writeFile(runtimePath, content);
          }),
          ...removedPaths.map(async (logicalPath) => {
            const runtimePath = toRuntimePath(logicalPath);
            await wc.fs.rm(runtimePath, { force: true, recursive: true });
          }),
        ]
      );

      syncedFilesRef.current = { ...files };
    },
    [ensureStarted, isReady]
  );

  const writeFile = useCallback(
    async (logicalPath: string, content: string) => {
      const wc = await ensureStarted();

      const runtimePath = toRuntimePath(logicalPath);
      const dirPath = toDirectoryPath(runtimePath);
      if (dirPath) {
        await wc.fs.mkdir(dirPath, { recursive: true });
      }
      await wc.fs.writeFile(runtimePath, content);
      syncedFilesRef.current = {
        ...syncedFilesRef.current,
        [logicalPath]: content,
      };
    },
    [ensureStarted]
  );

  const readFile = useCallback(
    async (logicalPath: string) => {
      const wc = await ensureStarted();
      const runtimePath = toRuntimePath(logicalPath);
      const content = await wc.fs.readFile(runtimePath, "utf-8");
      return typeof content === "string" ? content : new TextDecoder().decode(content);
    },
    [ensureStarted]
  );

  const readDir = useCallback(
    async (logicalPath: string) => {
      const wc = await ensureStarted();
      const runtimePath = logicalPath === "/" ? "/" : toRuntimePath(logicalPath);
      const entries = await wc.fs.readdir(runtimePath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: runtimePath === "/" ? `/${entry.name}` : `${runtimePath}/${entry.name}`,
        logicalPath: toLogicalPath(runtimePath === "/" ? entry.name : `${runtimePath}/${entry.name}`),
        kind: entry.isDirectory() ? "directory" : "file",
      }));
    },
    [ensureStarted]
  );

  const makeDir = useCallback(
    async (logicalPath: string) => {
      const wc = await ensureStarted();
      const runtimePath = logicalPath === "/" ? "/" : toRuntimePath(logicalPath);
      await wc.fs.mkdir(runtimePath, { recursive: true });
    },
    [ensureStarted]
  );

  const removePath = useCallback(
    async (logicalPath: string, options?: { recursive?: boolean }) => {
      const wc = await ensureStarted();
      const runtimePath = toRuntimePath(logicalPath);
      await wc.fs.rm(runtimePath, {
        force: true,
        recursive: options?.recursive ?? true,
      });

      const nextFiles = { ...syncedFilesRef.current };
      delete nextFiles[logicalPath];
      syncedFilesRef.current = nextFiles;
    },
    [ensureStarted]
  );

  const spawnProcess = useCallback(
    async (
      command: string,
      args: string[] = [],
      options?: { cwd?: string; waitForExit?: boolean }
    ) => {
      const wc = await ensureStarted();
      const process = await wc.spawn(command, args, options?.cwd ? { cwd: options.cwd } : undefined);
      const procId = registerProcess(process, `[proc] ${command} ${args.join(" ")}`.trim());

      if (options?.waitForExit) {
        await process.exit;
      }

      return getProcessSnapshot(procId);
    },
    [ensureStarted, getProcessSnapshot, registerProcess]
  );

  const readProcess = useCallback(async (procId: string) => {
    const snapshot = getProcessSnapshot(procId);
    if (!snapshot) {
      throw new Error(`Process not found: ${procId}`);
    }
    return snapshot;
  }, [getProcessSnapshot]);

  const killProcess = useCallback(async (procId: string) => {
    const managed = processesRef.current.get(procId);
    if (!managed) {
      return false;
    }

    managed.process.kill();
    return true;
  }, []);

  return useMemo(
    () => ({
      isReady,
      serverUrl,
      logs,
      syncFiles,
      readFile,
      readDir,
      makeDir,
      removePath,
      writeFile,
      spawnProcess,
      readProcess,
      killProcess,
    }),
    [isReady, killProcess, logs, makeDir, readDir, readFile, readProcess, removePath, serverUrl, spawnProcess, syncFiles, writeFile]
  );
}

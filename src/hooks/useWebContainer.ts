"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebContainer, type FileSystemTree } from "@webcontainer/api";

type FilesMap = Record<string, string>;

const BASE_PROJECT_FILES: FileSystemTree = {
  "package.json": {
    file: {
      contents: JSON.stringify(
        {
          name: "atoms-runtime",
          private: true,
          version: "0.0.1",
          type: "module",
          scripts: {
            dev: "vite --host 0.0.0.0 --port 5173",
          },
          dependencies: {
            react: "^19.2.0",
            "react-dom": "^19.2.0",
            "framer-motion": "^12.0.0",
            "lucide-react": "^1.0.0",
          },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^5.0.0",
            typescript: "^5.0.0",
            vite: "^7.0.0",
          },
        },
        null,
        2
      ),
    },
  },
  "index.html": {
    file: {
      contents:
        "<!doctype html><html><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"/><title>ATOMS Preview</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>",
    },
  },
  "tsconfig.json": {
    file: {
      contents: JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            lib: ["DOM", "DOM.Iterable", "ESNext"],
            skipLibCheck: true,
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
          },
          include: ["src"],
        },
        null,
        2
      ),
    },
  },
  "vite.config.ts": {
    file: {
      contents:
        "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n",
    },
  },
  src: {
    directory: {
      "main.tsx": {
        file: {
          contents:
            "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './index.css';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n",
        },
      },
      "index.css": {
        file: {
          contents:
            "html, body, #root { margin: 0; padding: 0; width: 100%; min-height: 100%; font-family: ui-sans-serif, system-ui; }\n",
        },
      },
    },
  },
};

const toRuntimePath = (logicalPath: string): string => {
  const normalized = logicalPath.startsWith("/") ? logicalPath.slice(1) : logicalPath;
  if (normalized.startsWith("src/")) {
    return normalized;
  }
  return `src/${normalized}`;
};

const toRuntimeTree = (files: FilesMap): FileSystemTree => {
  const srcEntries: Record<string, { file: { contents: string } }> = {};

  for (const [logicalPath, content] of Object.entries(files)) {
    const runtimePath = toRuntimePath(logicalPath);
    const cleaned = runtimePath.replace(/^src\//, "");
    srcEntries[cleaned] = { file: { contents: content } };
  }

  if (!srcEntries["App.tsx"]) {
    srcEntries["App.tsx"] = {
      file: {
        contents:
          "export default function App() { return <div style={{padding:20}}>Hello from ATOMS runtime</div>; }",
      },
    };
  }

  return {
    ...BASE_PROJECT_FILES,
    src: {
      directory: {
        ...(BASE_PROJECT_FILES.src as { directory: Record<string, { file: { contents: string } }> }).directory,
        ...srcEntries,
      },
    },
  };
};

const toDirectoryPath = (runtimePath: string): string => {
  const index = runtimePath.lastIndexOf("/");
  if (index <= 0) {
    return "";
  }
  return runtimePath.slice(0, index);
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

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        const wc = await WebContainer.boot();
        if (!mounted) {
          wc.teardown();
          return;
        }

        wcRef.current = wc;
        wc.on("server-ready", (_port, url) => {
          setServerUrl(url);
        });
        setIsReady(true);
      } catch (error) {
        setLogs((prev) => [...prev, `WebContainer boot failed: ${String(error)}`]);
      }
    };

    void boot();

    return () => {
      mounted = false;
      if (wcRef.current) {
        wcRef.current.teardown();
      }
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

  const syncFiles = useCallback(
    async (files: FilesMap) => {
      const wc = wcRef.current;
      if (!wc || !isReady) {
        return;
      }

      if (!startedRef.current) {
        if (!startingRef.current) {
          startingRef.current = (async () => {
            const tree = toRuntimeTree(files);
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
            void devProc.output.pipeTo(
              new WritableStream({
                write(data) {
                  appendLog(data);
                },
              })
            );

            startedRef.current = true;
            syncedFilesRef.current = { ...files };
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
        return;
      }

      const previous = syncedFilesRef.current;
      const changedEntries = Object.entries(files).filter(
        ([logicalPath, content]) => previous[logicalPath] !== content
      );

      if (!changedEntries.length) {
        return;
      }

      await Promise.all(
        changedEntries.map(async ([logicalPath, content]) => {
          const runtimePath = toRuntimePath(logicalPath);
          const dirPath = toDirectoryPath(runtimePath);
          if (dirPath) {
            await wc.fs.mkdir(dirPath, { recursive: true });
          }
          await wc.fs.writeFile(runtimePath, content);
        })
      );

      syncedFilesRef.current = { ...files };
    },
    [appendLog, isReady]
  );

  const writeFile = useCallback(
    async (logicalPath: string, content: string) => {
      const wc = wcRef.current;
      if (!wc || !startedRef.current) {
        return;
      }

      const runtimePath = toRuntimePath(logicalPath);
      const dirPath = toDirectoryPath(runtimePath);
      if (dirPath) {
        await wc.fs.mkdir(dirPath, { recursive: true });
      }
      await wc.fs.writeFile(runtimePath, content);
    },
    []
  );

  return useMemo(
    () => ({
      isReady,
      serverUrl,
      logs,
      syncFiles,
      writeFile,
    }),
    [isReady, logs, serverUrl, syncFiles, writeFile]
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useWebContainer } from "@/hooks/useWebContainer";
import { normalizeRemoteFiles } from "@/stores/projectStore";

type ProjectFile = {
  path: string;
  content: string;
};

export default function PreviewRuntime({ projectId, token }: { projectId: string; token: string }) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { isReady, serverUrl, syncFiles, logs } = useWebContainer();

  useEffect(() => {
    let mounted = true;

    const loadFiles = async () => {
      try {
        if (!token) {
          throw new Error("缺少分享令牌，无法访问预览内容");
        }

        const res = await fetch(
          `/api/public/projects/${projectId}/files?token=${encodeURIComponent(token)}`,
          { method: "GET" }
        );
        if (!res.ok) {
          throw new Error(`Failed to load project files (${res.status})`);
        }
        const json = (await res.json()) as { files?: ProjectFile[] };
        if (!mounted) return;
        setFiles(normalizeRemoteFiles(json.files ?? []));
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadFiles();

    return () => {
      mounted = false;
    };
  }, [projectId, token]);

  useEffect(() => {
    if (!isReady || loading || error) {
      return;
    }

    void syncFiles(files);
  }, [error, files, isReady, loading, syncFiles]);

  const status = useMemo(() => {
    if (error) return error;
    if (loading) return "正在加载项目文件...";
    if (!isReady) return "正在初始化运行时...";
    if (!serverUrl) return "运行时已启动，正在编译项目...";
    return null;
  }, [error, isReady, loading, serverUrl]);

  if (status) {
    return (
      <main className="w-full min-h-screen bg-background flex items-center justify-center px-6">
        <div className="max-w-3xl w-full rounded-2xl border border-border bg-background/80 p-6 text-center">
          <p className="text-sm text-muted-foreground">{status}</p>
          {!!logs.length && (
            <div className="mt-4 rounded-lg bg-black text-green-300 text-left text-xs p-3 max-h-64 overflow-auto">
              {logs.slice(-12).map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="w-full h-screen bg-background">
      <iframe title="Project Preview" src={serverUrl ?? "about:blank"} className="w-full h-full border-0" />
    </main>
  );
}

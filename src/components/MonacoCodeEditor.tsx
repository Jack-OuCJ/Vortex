"use client";

import { useEffect, useMemo, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";

const languageByPath = (path: string) => {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".html")) return "html";
  return "plaintext";
};

type MonacoCodeEditorProps = {
  activePath: string;
  files: Record<string, string>;
  onCodeChange: (path: string, nextCode: string) => void;
};

export function MonacoCodeEditor({ activePath, files, onCodeChange }: MonacoCodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "atoms-dark" : "atoms-light";

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelCacheRef = useRef<Map<string, any>>(new Map());
  const viewStateRef = useRef<Map<string, any>>(new Map());

  const activeCode = files[activePath] ?? "";
  const language = useMemo(() => languageByPath(activePath), [activePath]);

  const ensureModel = (monaco: Monaco, path: string, content: string) => {
    const cached = modelCacheRef.current.get(path);
    if (cached) {
      if (cached.getValue() !== content) {
        cached.setValue(content);
      }
      return cached;
    }

    const uri = monaco.Uri.parse(`file://${path}`);
    const model = monaco.editor.createModel(content, languageByPath(path), uri);
    modelCacheRef.current.set(path, model);
    return model;
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 注册与全局主题匹配的自定义主题
    monaco.editor.defineTheme("atoms-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#09090b",
        "editorLineNumber.foreground": "#a1a1aa",
        "editorLineNumber.activeForeground": "#3f64ff",
        "editor.lineHighlightBackground": "#f4f4f580",
        "editorIndentGuide.background1": "#e4e4e7",
        "editorIndentGuide.activeBackground1": "#a1a1aa",
        "editor.selectionBackground": "#3f64ff30",
      },
    });
    monaco.editor.defineTheme("atoms-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#09090b",
        "editor.foreground": "#fafafa",
        "editorLineNumber.foreground": "#52525b",
        "editorLineNumber.activeForeground": "#5271ff",
        "editor.lineHighlightBackground": "#27272a80",
        "editorIndentGuide.background1": "#27272a",
        "editorIndentGuide.activeBackground1": "#52525b",
        "editor.selectionBackground": "#5271ff40",
      },
    });
    monaco.editor.setTheme(monacoTheme);

    const model = ensureModel(monaco, activePath, activeCode);
    editor.setModel(model);

    const savedViewState = viewStateRef.current.get(activePath) ?? null;
    if (savedViewState) {
      editor.restoreViewState(savedViewState);
    }

    editor.focus();
  };

  // 跟随全局主题切换同步 Monaco 主题
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.editor.setTheme(monacoTheme);
  }, [monacoTheme]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const previousModel = editor.getModel();
    if (previousModel) {
      viewStateRef.current.set(previousModel.uri.path, editor.saveViewState());
    }

    const nextModel = ensureModel(monaco, activePath, activeCode);
    if (previousModel?.uri.toString() !== nextModel.uri.toString()) {
      editor.setModel(nextModel);
      const savedState = viewStateRef.current.get(activePath) ?? null;
      if (savedState) {
        editor.restoreViewState(savedState);
      }
    }
  }, [activeCode, activePath]);

  useEffect(() => {
    const modelCache = modelCacheRef.current;
    const viewStateCache = viewStateRef.current;

    return () => {
      for (const model of modelCache.values()) {
        model.dispose();
      }
      modelCache.clear();
      viewStateCache.clear();
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  return (
    <Editor
      height="100%"
      language={language}
      theme={monacoTheme}
      onMount={handleMount}
      onChange={(value) => {
        onCodeChange(activePath, value ?? "");
      }}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
      }}
    />
  );
}

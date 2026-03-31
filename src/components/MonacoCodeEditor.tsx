"use client";

import { useEffect, useMemo, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";

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
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const modelCacheRef = useRef<Map<string, Monaco.editor.ITextModel>>(new Map());
  const viewStateRef = useRef<Map<string, Monaco.editor.ICodeEditorViewState | null>>(new Map());

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

    const model = ensureModel(monaco, activePath, activeCode);
    editor.setModel(model);

    const savedViewState = viewStateRef.current.get(activePath) ?? null;
    if (savedViewState) {
      editor.restoreViewState(savedViewState);
    }

    editor.focus();
  };

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
      theme="vs-dark"
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

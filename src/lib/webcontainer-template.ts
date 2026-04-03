/**
 * WebContainer 运行时模板配置
 *
 * 这是 WebContainer 沙箱初始文件树的单一真相来源。
 * - 依赖：React 19 + Vite 7 + TypeScript + Tailwind CSS v4 + framer-motion + lucide-react
 * - 样式：Tailwind v4（@tailwindcss/vite 插件，无需 postcss.config / tailwind.config）
 * - 修改依赖版本时，请同步更新此文件并重新生成 package-lock.json（如有）。
 */

import type { FileSystemTree, DirectoryNode } from "@webcontainer/api";

type FilesMap = Record<string, string>;

const ROOT_LEVEL_RUNTIME_FILES = new Set([
  "package.json",
  "index.html",
  "tsconfig.json",
  "vite.config.ts",
  "todo.md",
]);

const GENERATED_RUNTIME_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "tsconfig.tsbuildinfo",
]);

const normalizeLogicalPath = (logicalPath: string): string => {
  if (!logicalPath.trim()) {
    return "/";
  }

  return logicalPath.startsWith("/") ? logicalPath : `/${logicalPath}`;
};

const PREVIEW_SCROLL_GUARD_MARKER = "data-vortex-preview-scroll-guard";

const PREVIEW_SCROLL_GUARD_SCRIPT = [
  `<script ${PREVIEW_SCROLL_GUARD_MARKER}="true">`,
  "(() => {",
  "  const blockedKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);",
  "",
  "  const isEditableTarget = (target) => {",
  "    if (!(target instanceof HTMLElement)) return false;",
  "    const tagName = target.tagName;",
  "    return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';",
  "  };",
  "",
  "  window.addEventListener('keydown', (event) => {",
  "    if (event.defaultPrevented || !blockedKeys.has(event.key) || isEditableTarget(event.target)) {",
  "      return;",
  "    }",
  "",
  "    event.preventDefault();",
  "  }, { passive: false });",
  "})();",
  "<\/script>",
].join('');

const injectPreviewScrollGuard = (content: string): string => {
  if (content.includes(PREVIEW_SCROLL_GUARD_MARKER)) {
    return content;
  }

  if (content.includes("</head>")) {
    return content.replace("</head>", `${PREVIEW_SCROLL_GUARD_SCRIPT}</head>`);
  }

  return `${PREVIEW_SCROLL_GUARD_SCRIPT}${content}`;
};

const toRuntimeFileContents = (runtimePath: string, content: string): string => {
  if (runtimePath === "index.html") {
    return injectPreviewScrollGuard(content);
  }

  return content;
};

// ---------------------------------------------------------------------------
// 基础文件树（模板）
// ---------------------------------------------------------------------------

export const WEBCONTAINER_TEMPLATE: FileSystemTree = {
  "package.json": {
    file: {
      contents: JSON.stringify(
        {
          name: "vortex-runtime",
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
            "lucide-react": "^0.511.0",
          },
          devDependencies: {
            "@tailwindcss/vite": "^4.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^5.0.0",
            tailwindcss: "^4.0.0",
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
      contents: toRuntimeFileContents(
        "index.html",
        '<!doctype html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>VORTEX Preview</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
      ),
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

  // Tailwind v4：通过 @tailwindcss/vite 插件接入，无需 postcss.config / tailwind.config
  "vite.config.ts": {
    file: {
      contents: [
        "import { defineConfig } from 'vite';",
        "import react from '@vitejs/plugin-react';",
        "import tailwindcss from '@tailwindcss/vite';",
        "",
        "export default defineConfig({ plugins: [react(), tailwindcss()] });",
        "",
      ].join("\n"),
    },
  },

  src: {
    directory: {
      "main.tsx": {
        file: {
          contents: [
            "import React from 'react';",
            "import { createRoot } from 'react-dom/client';",
            "import './index.css';",
            "import App from './App';",
            "",
            "createRoot(document.getElementById('root')!).render(",
            "  <React.StrictMode><App /></React.StrictMode>",
            ");",
            "",
          ].join("\n"),
        },
      },

      // Tailwind v4 指令：只需一行 @import
      "index.css": {
        file: {
          contents: [
            "@import 'tailwindcss';",
            "",
            "html, body, #root {",
            "  margin: 0;",
            "  padding: 0;",
            "  width: 100%;",
            "  min-height: 100%;",
            "  font-family: ui-sans-serif, system-ui;",
            "}",
            "",
          ].join("\n"),
        },
      },

      // 默认占位 App（等待 Agent 生成真实代码）
      "App.tsx": {
        file: {
          contents: [
            "export default function App() {",
            "  return (",
            "    <div className=\"min-h-screen bg-slate-50 flex items-center justify-center\">",
            "      <div className=\"text-center p-8\">",
            "        <h2 className=\"text-slate-800 text-xl font-semibold mb-2\">Ready to build</h2>",
            "        <p className=\"text-slate-500 text-sm\">Describe your app in the chat →</p>",
            "      </div>",
            "    </div>",
            "  );",
            "}",
            "",
          ].join("\n"),
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// 路径工具
// ---------------------------------------------------------------------------

/** 将逻辑路径（可能带 / 前缀或不带 src/ 前缀）标准化为运行时文件树路径。 */
export const toRuntimePath = (logicalPath: string): string => {
  const normalized = logicalPath.startsWith("/") ? logicalPath.slice(1) : logicalPath;
  if (ROOT_LEVEL_RUNTIME_FILES.has(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("src/")) {
    return normalized;
  }
  return `src/${normalized}`;
};

/** 将逻辑路径收敛为规范格式：业务代码固定使用 /src/...，仅少数运行时配置文件保留根目录。 */
export const canonicalizeLogicalPath = (logicalPath: string): string => {
  const normalized = normalizeLogicalPath(logicalPath);
  const withoutLeadingSlash = normalized.slice(1);

  if (!withoutLeadingSlash) {
    return "/";
  }

  if (ROOT_LEVEL_RUNTIME_FILES.has(withoutLeadingSlash)) {
    return normalized;
  }

  if (withoutLeadingSlash.startsWith("src/")) {
    return normalized;
  }

  return `/${toRuntimePath(withoutLeadingSlash)}`;
};

/** 返回旧版逻辑路径别名，用于迁移历史上扁平化到根目录的业务文件。 */
export const getLegacyLogicalAliases = (logicalPath: string): string[] => {
  const canonicalPath = canonicalizeLogicalPath(logicalPath);

  if (!canonicalPath.startsWith("/src/")) {
    return [];
  }

  return [`/${canonicalPath.slice(5)}`];
};

/** 将运行时路径映射回逻辑路径，保留真实目录层级。 */
export const toLogicalPath = (runtimePath: string): string => {
  return canonicalizeLogicalPath(`/${runtimePath}`);
};

/** 判断运行时文件是否应该持久化到数据库。 */
export const shouldPersistRuntimePath = (runtimePath: string): boolean => {
  const normalized = runtimePath.replace(/^\.\//, "");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";

  if (!fileName || GENERATED_RUNTIME_FILES.has(fileName)) {
    return false;
  }

  return !segments.some((segment) =>
    ["node_modules", "dist", ".git", ".vite", ".cache", ".next", "coverage"].includes(segment)
  );
};

/** 从运行时路径提取目录部分 */
export const toDirectoryPath = (runtimePath: string): string => {
  const index = runtimePath.lastIndexOf("/");
  if (index <= 0) {
    return "";
  }
  return runtimePath.slice(0, index);
};

// ---------------------------------------------------------------------------
// 文件树构建
// ---------------------------------------------------------------------------

/**
 * 将 Agent 产出的 {逻辑路径 → 代码} 映射合并到模板文件树中。
 * - src 下文件使用 /src/App.tsx 这类规范逻辑路径
 * - 兼容历史路径：/App.tsx 会自动映射到 /src/App.tsx
 * - 根目录文件使用 /package.json 这类逻辑路径
 * - 若 Agent 没有产出 App.tsx，则保留模板默认占位
 */
export const toRuntimeTree = (files: FilesMap): FileSystemTree => {
  const tree = structuredClone(WEBCONTAINER_TEMPLATE);

  for (const [logicalPath, content] of Object.entries(files)) {
    const runtimePath = toRuntimePath(logicalPath);
    const segments = runtimePath.split("/").filter(Boolean);
    const runtimeContent = toRuntimeFileContents(runtimePath, content);
    let cursor = tree;

    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const existing = cursor[segment];

      if (!existing || !("directory" in existing)) {
        cursor[segment] = { directory: {} };
      }

      cursor = (cursor[segment] as DirectoryNode).directory;
    }

    cursor[segments[segments.length - 1]] = { file: { contents: runtimeContent } };
  }

  return tree;
};

/** 展开模板文件树，返回可直接持久化到 project_files 的逻辑文件映射。 */
export const getPersistedTemplateFiles = (): FilesMap => {
  const result: FilesMap = {};

  const visit = (tree: FileSystemTree, currentPath = "") => {
    for (const [name, node] of Object.entries(tree)) {
      const runtimePath = currentPath ? `${currentPath}/${name}` : name;

      if ("file" in node) {
        if (
          shouldPersistRuntimePath(runtimePath) &&
          "contents" in node.file &&
          typeof node.file.contents === "string"
        ) {
          result[toLogicalPath(runtimePath)] = node.file.contents;
        }
        continue;
      }

      visit(node.directory, runtimePath);
    }
  };

  visit(WEBCONTAINER_TEMPLATE);
  return result;
};

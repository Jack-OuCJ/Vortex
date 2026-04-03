"use client";

import { useMemo } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { formatDisplayPath } from "@/lib/workflow";

type WorkbenchFileTreeProps = {
  activeFilePath: string;
  expandedDirectories: Record<string, true>;
  files: Record<string, string>;
  pendingPaths?: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
};

type FileTreeDirectoryNode = {
  kind: "directory";
  name: string;
  path: string;
  children: FileTreeNode[];
};

type FileTreeFileNode = {
  kind: "file";
  name: string;
  path: string;
};

type FileTreeNode = FileTreeDirectoryNode | FileTreeFileNode;

const renderFileIcon = (path: string) => {
  if (path.endsWith(".json")) {
    return <FileJson className="h-3.5 w-3.5 shrink-0" />;
  }

  if (/\.(ts|tsx|js|jsx|css|html|md|sql)$/i.test(path)) {
    return <FileCode className="h-3.5 w-3.5 shrink-0" />;
  }

  return <FileText className="h-3.5 w-3.5 shrink-0" />;
};

const compareNodes = (left: FileTreeNode, right: FileTreeNode) => {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }

  return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
};

const buildFileTree = (paths: string[]): FileTreeNode[] => {
  const root: FileTreeDirectoryNode = {
    kind: "directory",
    name: "",
    path: "",
    children: [],
  };

  const directoryMap = new Map<string, FileTreeDirectoryNode>([["", root]]);

  paths.forEach((path) => {
    const segments = path.split("/").filter(Boolean);
    if (!segments.length) {
      return;
    }

    let currentPath = "";
    let parent = root;

    segments.forEach((segment, index) => {
      currentPath = `${currentPath}/${segment}`;
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        parent.children.push({
          kind: "file",
          name: segment,
          path: currentPath,
        });
        return;
      }

      let directory = directoryMap.get(currentPath);

      if (!directory) {
        directory = {
          kind: "directory",
          name: segment,
          path: currentPath,
          children: [],
        };
        directoryMap.set(currentPath, directory);
        parent.children.push(directory);
      }

      parent = directory;
    });
  });

  const sortTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
    return nodes
      .map((node) => {
        if (node.kind === "directory") {
          return {
            ...node,
            children: sortTree(node.children),
          };
        }

        return node;
      })
      .sort(compareNodes);
  };

  return sortTree(root.children);
};

const FileTreeBranch = ({
  activeFilePath,
  depth,
  expandedDirectories,
  node,
  pendingPaths,
  onSelectFile,
  onToggleDirectory,
}: {
  activeFilePath: string;
  depth: number;
  expandedDirectories: Record<string, true>;
  node: FileTreeNode;
  pendingPaths?: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) => {
  const paddingLeft = 12 + depth * 14;

  if (node.kind === "file") {
    const isActive = node.path === activeFilePath;
    const isPending = pendingPaths?.has(node.path) ?? false;

    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        className={`flex w-full items-center gap-2 py-2 pr-3 text-left text-xs transition-colors ${
          isActive
            ? "bg-blue-500/15 text-foreground"
            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        }`}
        style={{ paddingLeft }}
      >
        {renderFileIcon(node.path)}
        <span className="truncate flex-1">{formatDisplayPath(node.path)}</span>
        {isPending && (
          <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />
        )}
      </button>
    );
  }

  const isExpanded = !!expandedDirectories[node.path];

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggleDirectory(node.path)}
        className="flex w-full items-center gap-2 py-2 pr-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        style={{ paddingLeft }}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded ? (
        <div>
          {node.children.map((child) => (
            <FileTreeBranch
              key={child.path}
              activeFilePath={activeFilePath}
              depth={depth + 1}
              expandedDirectories={expandedDirectories}
              node={child}
              pendingPaths={pendingPaths}
              onSelectFile={onSelectFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export function WorkbenchFileTree({
  activeFilePath,
  expandedDirectories,
  files,
  pendingPaths,
  onSelectFile,
  onToggleDirectory,
}: WorkbenchFileTreeProps) {
  const tree = useMemo(() => buildFileTree(Object.keys(files)), [files]);

  return (
    <div className="py-2">
      {tree.map((node) => (
        <FileTreeBranch
          key={node.path}
          activeFilePath={activeFilePath}
          depth={0}
          expandedDirectories={expandedDirectories}
          node={node}
          pendingPaths={pendingPaths}
          onSelectFile={onSelectFile}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
    </div>
  );
}
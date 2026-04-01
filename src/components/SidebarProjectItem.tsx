import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { ProjectMeta, useHistoryStore } from "@/stores/historyStore";

export function SidebarProjectItem({ project }: { project: ProjectMeta }) {
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { updateProjectName, deleteProject } = useHistoryStore();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleRename = async () => {
    if (editName.trim() && editName !== project.name) {
      await updateProjectName(project.id, editName.trim());
    }
    setIsEditing(false);
    setShowMenu(false);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    await deleteProject(project.id);
    setIsDeleting(false);
    setShowDeleteConfirm(false);
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
    setShowMenu(false);
  };

  return (
    <div className="group relative w-full flex items-center justify-between px-2 py-2 rounded-md hover:bg-foreground/5 text-sm text-foreground/75 transition-colors">
      <button 
        className="flex items-center gap-2.5 flex-1 min-w-0"
        onClick={() => {
          if (!isEditing) router.push(`/workbench?project_id=${project.id}`);
        }}
      >
        <MessageSquare className="size-4 opacity-70 flex-shrink-0" />
        {isEditing ? (
          <input
            type="text"
            className="w-full bg-transparent border-b border-primary outline-none focus:border-primary text-sm text-foreground px-1"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setIsEditing(false);
                setEditName(project.name);
              }
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate">{project.name}</span>
        )}
      </button>

      {!isEditing && (
        <div className="relative" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-foreground/10 rounded transition-opacity"
          >
            <MoreHorizontal className="size-4" />
          </button>

          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="absolute left-0 top-full mt-1 w-32 bg-popover border border-border rounded-md shadow-md z-[60] overflow-hidden"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditing(true);
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
                >
                  <Pencil className="size-3.5" /> 重命名
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors text-left"
                >
                  <Trash2 className="size-3.5 text-red-500" /> 删除
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background border border-border w-full max-w-sm rounded-[16px] shadow-xl p-5 flex flex-col gap-4 text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold tracking-tight">删除项目</h3>
                <p className="text-sm text-foreground/70 leading-relaxed">
                  您确定要删除项目 <span className="font-semibold text-foreground">&quot;{project.name}&quot;</span> 吗？此操作无法撤销。
                </p>
                
                <div className="mt-2 flex items-center justify-end gap-2">
                  <button
                    disabled={isDeleting}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowDeleteConfirm(false);
                    }}
                    className="px-4 py-2 rounded-full text-sm font-medium hover:bg-muted text-foreground/80 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    disabled={isDeleting}
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete();
                    }}
                    className="px-4 py-2 rounded-full text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-1.5"
                  >
                    {isDeleting ? "删除中..." : "确认删除"}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}

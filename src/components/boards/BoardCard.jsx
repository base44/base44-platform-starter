import React from "react";
import Link from "next/link";
import { createPageUrl } from "@/utils";
import { MoreHorizontal, Trash2, Edit3, ArrowRight, CheckSquare, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getBoardColor, boardInitial, personInitial, readableText } from "@/lib/boardColor";

/**
 * `canManage` is board ownership, not a role: a board someone else marked `shared`
 * lists here and opens read-only, so offering Edit/Delete on it would be offering a
 * call the API answers with a 404. The pill stays the plain visibility either way —
 * the board view names the owner, which is where it matters.
 */
export default function BoardCard({
  board,
  viewMode,
  index,
  itemCount = 0,
  onDelete,
  onEdit,
  canManage = true,
}) {
  const handleDelete = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`Delete "${board.title}"? This cannot be undone.`)) {
      onDelete(board.id);
    }
  };

  const handleEdit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onEdit(board);
  };

  const boardColor = getBoardColor(board);
  const ink = readableText(boardColor);
  const taskLabel = `${itemCount} ${itemCount === 1 ? "task" : "tasks"}`;

  if (viewMode === "list") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.03 }}
        className="group flex items-center gap-3.5 py-3 hover:bg-secondary/40 -mx-3 px-3 rounded-lg transition-colors"
      >
        <div
          className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-semibold shadow-sm"
          style={{ backgroundColor: boardColor, color: ink }}
        >
          {boardInitial(board)}
        </div>
        <Link
          href={createPageUrl(`Board?id=${board.id}`)}
          className="flex-1 min-w-0 flex items-center gap-4"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{board.title}</p>
            {board.description && (
              <p className="text-xs text-muted-foreground truncate">{board.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground hidden sm:block">{taskLabel}</span>
            <span className="text-xs text-muted-foreground hidden md:block">
              {formatDistanceToNow(new Date(board.updated_date), { addSuffix: true })}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                board.visibility === "shared"
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {board.visibility}
            </span>
          </div>
        </Link>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="reveal-on-hover p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEdit}>
                <Edit3 className="w-3.5 h-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </motion.div>
    );
  }

  // Grid view
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="group"
    >
      <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm hover:border-primary/40 hover:shadow-md transition-all h-full flex flex-col">
        {/* Cover banner */}
        <div
          className="h-20 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${boardColor} 0%, ${boardColor}bb 100%)` }}
        >
          <span
            className="absolute -bottom-3 right-3 font-bold text-6xl leading-none select-none"
            style={{ color: ink, opacity: 0.22 }}
          >
            {boardInitial(board)}
          </span>
          <span
            className="absolute top-2.5 right-2.5 text-[11px] px-2 py-0.5 rounded-full backdrop-blur-sm"
            style={{ backgroundColor: `${ink}26`, color: ink }}
          >
            {board.visibility}
          </span>
        </div>

        <Link href={createPageUrl(`Board?id=${board.id}`)} className="flex-1 p-4 block">
          <h3 className="text-sm font-semibold text-foreground leading-snug mb-1.5">
            {board.title}
          </h3>
          <p className="text-xs text-muted-foreground line-clamp-2 mb-4 min-h-[2.5rem]">
            {board.description || "No description."}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{taskLabel}</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span>{formatDistanceToNow(new Date(board.updated_date), { addSuffix: true })}</span>
          </div>
        </Link>

        <div className="border-t border-border px-3 py-2 flex items-center justify-between">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent("open-assistant", { detail: { mode: "build" } }),
              );
            }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Build an app
          </button>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleEdit}>
                  <Edit3 className="w-3.5 h-3.5 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </motion.div>
  );
}

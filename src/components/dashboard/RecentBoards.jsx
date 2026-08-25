import React, { useState } from "react";
import Link from "next/link";
import { createPageUrl } from "@/utils";
import { ArrowRight, Plus, LayoutGrid, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import CreateBoardModal from "@/components/boards/CreateBoardModal";
import { getBoardColor, boardInitial, personInitial, readableText } from "@/lib/boardColor";

export default function RecentBoards({ boards, items = [], isLoading, onCreateBoard }) {
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleCreateBoard = async (boardData) => {
    if (onCreateBoard) await onCreateBoard(boardData);
    setShowCreateModal(false);
  };

  const countFor = (boardId) => items.filter((it) => it.board_id === boardId).length;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3 h-6">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          Recent boards
        </h2>
        <Link
          href={createPageUrl("Boards")}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <div className="bg-card border border-border rounded-lg shadow-sm p-4 md:p-6 overflow-hidden">
        {isLoading ? (
          <div className="space-y-1">
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="w-9 h-9 rounded-lg flex-shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-3 w-12 flex-shrink-0" />
                </div>
              ))}
          </div>
        ) : boards.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">No boards yet</p>
            <p className="text-xs text-muted-foreground mb-5 max-w-xs mx-auto">
              Create your first board to start organizing tasks, priorities and timelines.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> Create your first board
            </button>
          </div>
        ) : (
          <div className="-mx-3">
            {boards.slice(0, 3).map((board) => {
              const color = getBoardColor(board);
              const count = countFor(board.id);
              return (
                <Link
                  key={board.id}
                  href={createPageUrl(`Board?id=${board.id}`)}
                  className="group flex items-center gap-3.5 py-3 px-3 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <div
                    className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center text-sm font-semibold shadow-sm"
                    style={{ backgroundColor: color, color: readableText(color) }}
                  >
                    {boardInitial(board)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{board.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {count} {count === 1 ? "task" : "tasks"}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-border" />
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(board.updated_date), "MMM d")}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`hidden sm:inline-block text-[11px] px-2 py-0.5 rounded-full ${
                        board.visibility === "shared"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {board.visibility}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <CreateBoardModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateBoard}
      />
    </div>
  );
}

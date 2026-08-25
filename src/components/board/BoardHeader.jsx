import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Board } from "@/lib/entityClient";
import { createPageUrl } from "@/utils";
import {
  ArrowLeft,
  Star,
  Activity,
  Table2,
  ChevronDown,
  TrendingUp,
  Edit3,
  Save,
  Zap,
  UserMinus,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function BoardHeader({
  board,
  items,
  itemsCount,
  selectedCount,
  currentView,
  onViewChange,
  onShowAnalytics,
  onShowIntegrations,
  onShowAutomations,
  onBoardUpdate,
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(board?.title || "");
  const [lastSaved, setLastSaved] = useState(new Date());

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setLastSaved(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (board?.title) {
      setEditedTitle(board.title);
    }
  }, [board?.title]);

  const boardColor = board?.color || "#0E2E56";

  const handleSaveTitle = async () => {
    if (!editedTitle.trim() || !board?.id) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    try {
      await Board.update(board.id, { title: editedTitle.trim() });
      onBoardUpdate?.({ ...board, title: editedTitle.trim() });
    } catch (error) {
      console.error("Error saving board title:", error);
      setEditedTitle(board.title); // revert on failure
    }
  };

  const handleToggleFavorite = () => {
    setIsFavorited(!isFavorited);
  };

  return (
    <>
      <div className="bg-background sticky top-14 z-40 border-b border-border">
        <div
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ backgroundColor: boardColor }}
        />

        <div className="px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href={createPageUrl("Boards")}
                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>

              <div className="flex items-center gap-3">
                <div className="space-y-0.5">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle();
                          if (e.key === "Escape") setIsEditing(false);
                        }}
                        className="text-base font-medium h-8 w-56"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveTitle}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <h1
                      className="text-base font-semibold text-foreground cursor-pointer flex items-center gap-1.5 group"
                      onClick={() => setIsEditing(true)}
                    >
                      {board?.title}
                      <Edit3 className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </h1>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-1 hover:text-foreground transition-colors">
                          <Table2 className="w-3 h-3" />
                          {currentView === "table"
                            ? "Main table"
                            : currentView === "kanban"
                              ? "Kanban"
                              : currentView === "calendar"
                                ? "Calendar"
                                : currentView === "timeline"
                                  ? "Timeline"
                                  : currentView === "unassigned"
                                    ? "Unassigned"
                                    : "Main table"}
                          <ChevronDown className="w-3 h-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => onViewChange("table")}>
                          <Table2 className="w-4 h-4 mr-2" />
                          Main Table
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewChange("kanban")}>
                          <Table2 className="w-4 h-4 mr-2" />
                          Kanban Board
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewChange("calendar")}>
                          <Table2 className="w-4 h-4 mr-2" />
                          Calendar View
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewChange("timeline")}>
                          <Table2 className="w-4 h-4 mr-2" />
                          Timeline
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onViewChange("unassigned")}>
                          <UserMinus className="w-4 h-4 mr-2" />
                          Unassigned Tasks
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <span className="text-border">·</span>
                    <span>{itemsCount} items</span>
                    <span className="text-border">·</span>
                    <button
                      className={`flex items-center gap-1 hover:text-foreground transition-colors ${isFavorited ? "text-foreground" : ""}`}
                      onClick={handleToggleFavorite}
                    >
                      <Star className={`w-3 h-3 ${isFavorited ? "fill-current" : ""}`} />
                      {isFavorited ? "Favorited" : "Favorite"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 px-2.5 py-1.5 rounded hover:bg-primary/10 transition-colors"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-assistant", { detail: { mode: "build" } }),
                  )
                }
              >
                <Sparkles className="w-3.5 h-3.5" />
                Build a tool
              </button>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                onClick={onShowAnalytics}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Analytics
              </button>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                onClick={onShowIntegrations}
              >
                <Activity className="w-3.5 h-3.5" />
                Integrate
              </button>
              <button
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                onClick={onShowAutomations}
              >
                <Zap className="w-3.5 h-3.5" />
                Automate
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

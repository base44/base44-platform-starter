import { Board, Item } from "@/lib/entityClient";
import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { createPageUrl } from "@/utils";
import { Plus, Search, Grid3X3, LayoutList } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import CreateBoardModal from "../components/boards/CreateBoardModal";
import EditBoardModal from "../components/boards/EditBoardModal";
import BoardCard from "../components/boards/BoardCard";
import ImportBoardModal from "../components/boards/ImportBoardModal";
import WorkspaceBanner from "../components/workspace/WorkspaceBanner";
import { WORKSPACE_BRAND } from "@/lib/workspaceBrand";

export default function Boards() {
  const [boards, setBoards] = useState([]);
  const [items, setItems] = useState([]);
  const [filteredBoards, setFilteredBoards] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingBoard, setEditingBoard] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("grid");

  useEffect(() => {
    loadBoards();
  }, []);
  useEffect(() => {
    filterBoards();
  }, [searchQuery, boards]);

  const loadBoards = async () => {
    setIsLoading(true);
    const [data, itemsData] = await Promise.all([
      Board.list("-updated_date"),
      Item.list("-updated_date", 1000),
    ]);
    setBoards(data);
    setItems(itemsData);
    setIsLoading(false);
  };

  const itemCounts = items.reduce((acc, it) => {
    acc[it.board_id] = (acc[it.board_id] || 0) + 1;
    return acc;
  }, {});

  const filterBoards = () => {
    if (!searchQuery) {
      setFilteredBoards(boards);
      return;
    }
    const q = searchQuery.toLowerCase();
    setFilteredBoards(
      boards.filter(
        (b) => b.title.toLowerCase().includes(q) || b.description?.toLowerCase().includes(q),
      ),
    );
  };

  const handleCreateBoard = async (boardData) => {
    const newBoard = await Board.create(boardData);
    setBoards((prev) =>
      [newBoard, ...prev].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date)),
    );
    setShowCreateModal(false);
  };

  const handleOpenEditModal = (board) => {
    setEditingBoard(board);
    setShowEditModal(true);
  };

  const handleUpdateBoard = async (boardId, updatedData) => {
    try {
      await Board.update(boardId, updatedData);
      setBoards((prev) =>
        prev
          .map((b) =>
            b.id === boardId ? { ...b, ...updatedData, updated_date: new Date().toISOString() } : b,
          )
          .sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date)),
      );
      setShowEditModal(false);
      setEditingBoard(null);
    } catch {
      loadBoards();
    }
  };

  const handleDeleteBoard = async (boardId) => {
    try {
      await Board.delete(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="border-b border-border">
        <div className="px-4 sm:px-6 py-6 md:py-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Workspace</p>
              <h1 className="font-display text-3xl md:text-4xl text-foreground">
                {WORKSPACE_BRAND.name} Boards
              </h1>
            </div>
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                onClick={() => setShowImportModal(true)}
                className="inline-flex items-center gap-2 border border-border text-sm font-medium px-4 py-2 rounded hover:bg-secondary transition-colors"
              >
                Import CSV
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Board
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 pt-4">
        <WorkspaceBanner />
      </div>

      <div className="px-4 sm:px-6 py-6">
        {/* Controls */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search boards…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm bg-card border-border rounded"
            />
          </div>
          <div className="flex items-center gap-1 border border-border rounded p-0.5 bg-card">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-1.5 rounded transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutList className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Boards */}
        <AnimatePresence mode="wait">
          {isLoading ? (
            <div
              className={
                viewMode === "grid"
                  ? "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                  : "space-y-px"
              }
            >
              {Array(6)
                .fill(0)
                .map((_, i) =>
                  viewMode === "grid" ? (
                    <div
                      key={i}
                      className="bg-card border border-border rounded animate-pulse h-36"
                    />
                  ) : (
                    <div
                      key={i}
                      className="bg-card border-b border-border py-3 flex gap-4 animate-pulse"
                    >
                      <div className="w-1 h-5 bg-muted rounded" />
                      <div className="flex-1 h-4 bg-muted rounded" />
                    </div>
                  ),
                )}
            </div>
          ) : filteredBoards.length === 0 ? (
            <div className="py-24 text-center">
              <p className="text-muted-foreground text-sm mb-4">
                {searchQuery ? "No boards match your search." : "No boards yet."}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Create your first board
                </button>
              )}
            </div>
          ) : (
            <div
              className={
                viewMode === "grid"
                  ? "grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                  : "divide-y divide-border"
              }
            >
              {filteredBoards.map((board, index) => (
                <BoardCard
                  key={board.id}
                  board={board}
                  viewMode={viewMode}
                  index={index}
                  itemCount={itemCounts[board.id] || 0}
                  onDelete={handleDeleteBoard}
                  onEdit={handleOpenEditModal}
                />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Refetch rather than prepending the returned board: it carries no item
          count, so the card read "0 tasks" for an import that had just created
          dozens. Closing is left to the modal's own Done button, which is what
          makes its success state reachable at all. */}
      <ImportBoardModal
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => loadBoards()}
      />
      <CreateBoardModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateBoard}
      />
      {editingBoard && (
        <EditBoardModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingBoard(null);
          }}
          onSubmit={handleUpdateBoard}
          board={editingBoard}
        />
      )}
    </div>
  );
}

import { Board, Item } from "@/lib/entityClient";
import React, { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Filter,
  Users,
  // MoreHorizontal, // Removed as it's no longer directly used here for panel controls
  ArrowLeft,
  SortAsc,
  Eye,
  EyeOff,
  Group as GroupIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DragDropContext } from "@hello-pangea/dnd";
import { createPageUrl } from "@/utils";

import BoardHeader from "../components/board/BoardHeader";
import GroupSection from "../components/board/GroupSection";
import NewTaskModal from "../components/board/NewTaskModal";
import FilterPanel from "../components/board/FilterPanel";
import SortMenu from "../components/board/SortMenu";
import PersonFilter from "../components/board/PersonFilter";
import HideMenu from "../components/board/HideMenu";
import GroupByMenu from "../components/board/GroupByMenu";
import NewColumnModal from "../components/board/NewColumnModal";
import NewGroupModal from "../components/board/NewGroupModal";
import KanbanView from "../components/board/views/KanbanView";
import TimelineView from "../components/board/views/TimelineView";

import AnalyticsPanel from "../components/board/analytics/AnalyticsPanel";
import IntegrationsPanel from "../components/board/integrations/IntegrationsPanel";
import AutomationsPanel from "../components/board/automations/AutomationsPanel";

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

export default function BoardPage() {
  // next/navigation returns the params object directly.
  const searchParams = useSearchParams();
  const boardId = searchParams.get("id");

  // A board someone else marked `shared` loads here (readWhere() in src/lib/rls.ts)
  // but every write still goes through the owner predicate, so the API would answer
  // 404. Rather than let the UI fire calls that quietly fail, ownership gates each
  // mutation below and the affordances that reach them. Null while the session
  // resolves — "not mine" is the safe reading.
  const { data: session } = useSession();
  const myEmail = session?.user?.email ?? null;

  const [board, setBoard] = useState(null);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [currentView, setCurrentView] = useState("table");

  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showPersonFilter, setShowPersonFilter] = useState(false);
  const [showHideMenu, setShowHideMenu] = useState(false);
  const [showGroupByMenu, setShowGroupByMenu] = useState(false);
  const [showNewColumnModal, setShowNewColumnModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);

  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);

  const [filters, setFilters] = useState({
    status: [],
    people: [],
    priority: [],
  });
  const [sortBy, setSortBy] = useState("order_index");
  const [sortDirection, setSortDirection] = useState("asc");
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [groupBy, setGroupBy] = useState("group");

  useEffect(() => {
    if (boardId) {
      loadBoardAndItems();
    }
  }, [boardId]);

  const loadBoardAndItems = async () => {
    setIsLoading(true);
    try {
      const boardDataPromise = Board.filter({ id: boardId });
      const itemsDataPromise = Item.filter({ board_id: boardId }, "order_index");

      const [boardResponse, itemsData] = await Promise.all([boardDataPromise, itemsDataPromise]);

      if (boardResponse.length > 0) {
        setBoard(boardResponse[0]);
      } else {
        setBoard(null);
      }
      setItems(itemsData);
    } catch (error) {
      console.error("Error loading board and items:", error);
      setBoard(null);
    }
    setIsLoading(false);
  };

  const canEdit = Boolean(myEmail) && board?.created_by === myEmail;

  const handleAddItem = async (groupId, title) => {
    if (!boardId || !board || !canEdit) return;

    const maxOrder = Math.max(
      0,
      ...items.filter((item) => item.group_id === groupId).map((item) => item.order_index || 0),
    );

    const newItemData = {};
    if (board.columns) {
      board.columns.forEach((column) => {
        if (column.id === "task") return;

        switch (column.type) {
          case "text":
            newItemData[column.id] = "";
            break;
          case "status":
            newItemData[column.id] = column.options?.choices?.[0]?.label || null;
            break;
          case "date":
            newItemData[column.id] = null;
            break;
          case "people":
            newItemData[column.id] = null;
            break;
          case "number":
            newItemData[column.id] = null;
            break;
          case "tags":
            newItemData[column.id] = [];
            break;
          case "checkbox":
            newItemData[column.id] = false;
            break;
          case "dropdown":
            newItemData[column.id] = column.options?.choices?.[0]?.value || null;
            break;
          case "priority":
            newItemData[column.id] = column.options?.choices?.[0]?.value || null;
            break;
          default:
            newItemData[column.id] = null;
        }
      });
    }

    try {
      const newItem = await Item.create({
        board_id: boardId,
        group_id: groupId,
        title: title,
        order_index: maxOrder + 1,
        data: newItemData,
      });
      setItems((prev) =>
        [...prev, newItem].sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
      );
    } catch (error) {
      console.error("Error adding item:", error);
    }
  };

  const handleUpdateItem = async (itemId, updates) => {
    if (!canEdit) return;
    try {
      await Item.update(itemId, updates);
      setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...updates } : item)));
      // If items are updated, reload them to refresh panels if visible
      if (showAnalytics || showIntegrations || showAutomations) {
        loadBoardAndItems();
      }
    } catch (error) {
      console.error("Error updating item:", error);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!canEdit) return;
    try {
      await Item.delete(itemId);
      setItems((prev) => prev.filter((item) => item.id !== itemId));
      if (showAnalytics || showIntegrations || showAutomations) {
        loadBoardAndItems();
      }
    } catch (error) {
      console.error("Error deleting item:", error);
    }
  };

  const handleReorderItems = async (groupId, sourceIndex, destinationIndex) => {
    if (!canEdit) return;
    const groupItems = items
      .filter((item) => item.group_id === groupId)
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (
      sourceIndex < 0 ||
      sourceIndex >= groupItems.length ||
      destinationIndex < 0 ||
      destinationIndex >= groupItems.length
    ) {
      console.warn("Invalid indices for reordering items.");
      return;
    }

    const [reorderedItem] = groupItems.splice(sourceIndex, 1);
    groupItems.splice(destinationIndex, 0, reorderedItem);

    const updates = groupItems.map((item, index) => ({
      ...item,
      order_index: index,
    }));

    setItems((prev) => {
      const otherItems = prev.filter((item) => item.group_id !== groupId);
      return [...otherItems, ...updates].sort(
        (a, b) => (a.order_index || 0) - (b.order_index || 0),
      );
    });

    try {
      await Promise.all(
        updates.map((item) => Item.update(item.id, { order_index: item.order_index })),
      );
    } catch (error) {
      console.error("Error reordering items:", error);
      loadBoardAndItems();
    }
  };

  const handleAddColumn = async (columnData) => {
    if (!board || !canEdit) return;
    const newColumn = { ...columnData, id: generateId(), width: columnData.width || 150 };
    const updatedColumns = [...(board.columns || []), newColumn];

    // Also update all groups to include the new column in their visible_columns
    const updatedGroups = (board.groups || []).map((group) => {
      const currentVisibleColumns =
        group.visible_columns || board.columns?.map((col) => col.id) || [];
      return {
        ...group,
        visible_columns: [...currentVisibleColumns, newColumn.id],
      };
    });

    try {
      await Board.update(board.id, {
        columns: updatedColumns,
        groups: updatedGroups,
      });
      setBoard((prev) => ({
        ...prev,
        columns: updatedColumns,
        groups: updatedGroups,
      }));
      setShowNewColumnModal(false);
    } catch (error) {
      console.error("Error adding column:", error);
    }
  };

  const handleUpdateColumn = async (columnId, updatedData) => {
    if (!board || !canEdit) return;
    const updatedColumns = board.columns.map((col) =>
      col.id === columnId ? { ...col, ...updatedData } : col,
    );
    try {
      await Board.update(board.id, { columns: updatedColumns });
      setBoard((prev) => ({ ...prev, columns: updatedColumns }));
    } catch (error) {
      console.error("Error updating column:", error);
    }
  };

  const handleDeleteColumn = async (columnId) => {
    if (!board || !canEdit) return;
    const updatedColumns = board.columns.filter((col) => col.id !== columnId);
    const updatedItems = items.map((item) => {
      const newData = { ...item.data };
      delete newData[columnId];
      return { ...item, data: newData };
    });

    try {
      await Board.update(board.id, { columns: updatedColumns });
      setBoard((prev) => ({ ...prev, columns: updatedColumns }));
      setItems(updatedItems);
    } catch (error) {
      console.error("Error deleting column:", error);
    }
  };

  const handleAddGroup = async (groupData) => {
    if (!board || !canEdit) return;
    const newGroup = { ...groupData, id: generateId(), collapsed: false };
    const updatedGroups = [...(board.groups || []), newGroup];
    try {
      await Board.update(board.id, { groups: updatedGroups });
      setBoard((prev) => ({ ...prev, groups: updatedGroups }));
      setShowNewGroupModal(false);
    } catch (error) {
      console.error("Error adding group:", error);
    }
  };

  const handleRenameGroup = async (groupId, newTitle) => {
    if (!board || !newTitle.trim() || !canEdit) return;
    const updatedGroups = board.groups.map((g) =>
      g.id === groupId ? { ...g, title: newTitle.trim() } : g,
    );
    try {
      await Board.update(board.id, { groups: updatedGroups });
      setBoard((prev) => ({ ...prev, groups: updatedGroups }));
    } catch (error) {
      console.error("Error renaming group:", error);
    }
  };

  const handleDeleteGroup = async (groupIdToDelete) => {
    if (!board || !canEdit) return;

    if (
      !window.confirm(
        "Are you sure you want to delete this group and all its tasks? This action cannot be undone.",
      )
    ) {
      return;
    }

    const updatedGroups = board.groups.filter((group) => group.id !== groupIdToDelete);
    const itemsOfDeletedGroup = items.filter((item) => item.group_id === groupIdToDelete);
    const itemDeletePromises = itemsOfDeletedGroup.map((item) => Item.delete(item.id));

    try {
      await Board.update(board.id, { groups: updatedGroups });
      await Promise.all(itemDeletePromises);
      setBoard((prevBoard) => ({ ...prevBoard, groups: updatedGroups }));
      setItems((prevItems) => prevItems.filter((item) => item.group_id !== groupIdToDelete));
      console.log(`Group ${groupIdToDelete} and its items deleted successfully.`);
    } catch (error) {
      console.error("Error deleting group:", error);
      loadBoardAndItems();
    }
  };

  const handleHideColumnFromGroup = async (groupId, columnId) => {
    if (!board || !canEdit) return;

    const updatedGroups = board.groups.map((group) => {
      if (group.id === groupId) {
        const currentVisibleColumns = group.visible_columns || board.columns.map((col) => col.id);
        const newVisibleColumns = currentVisibleColumns.filter((id) => id !== columnId);
        return { ...group, visible_columns: newVisibleColumns };
      }
      return group;
    });

    try {
      await Board.update(board.id, { groups: updatedGroups });
      setBoard((prev) => ({ ...prev, groups: updatedGroups }));
    } catch (error) {
      console.error("Error hiding column from group:", error);
    }
  };

  const handleViewChange = (newView) => {
    setCurrentView(newView);
  };

  const handleReorderColumns = async (sourceIndex, destinationIndex) => {
    if (!board || !canEdit) return;
    const cols = [...(board.columns || [])];
    const [moved] = cols.splice(sourceIndex, 1);
    cols.splice(destinationIndex, 0, moved);
    setBoard((prev) => ({ ...prev, columns: cols }));
    try {
      await Board.update(board.id, { columns: cols });
    } catch (error) {
      console.error("Error reordering columns:", error);
      loadBoardAndItems();
    }
  };

  const handleBoardDragEnd = (result) => {
    if (!result.destination) return;
    const { source, destination, type } = result;
    if (source.index === destination.index && source.droppableId === destination.droppableId)
      return;

    if (type === "COLUMN") {
      // Column droppable IDs are `columns-{groupId}` — reorder is board-level
      handleReorderColumns(source.index, destination.index);
      return;
    }

    if (source.droppableId !== destination.droppableId) return;
    handleReorderItems(source.droppableId, source.index, destination.index);
  };

  const filteredItems = items.filter((item) => {
    if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filters.status.length > 0 && !filters.status.includes(item.data?.status)) {
      return false;
    }
    if (filters.people.length > 0 && !filters.people.includes(item.data?.owner)) {
      return false;
    }
    if (filters.priority.length > 0 && !filters.priority.includes(item.data?.priority)) {
      return false;
    }
    return true;
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    let aValue = a[sortBy] || a.data?.[sortBy] || "";
    let bValue = b[sortBy] || b.data?.[sortBy] || "";

    if (aValue === null || aValue === undefined) aValue = "";
    if (bValue === null || bValue === undefined) bValue = "";

    if (sortDirection === "desc") {
      [aValue, bValue] = [bValue, aValue];
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return aValue.localeCompare(bValue);
    } else {
      return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
    }
  });

  const groupedItems =
    board?.groups?.reduce((acc, group) => {
      acc[group.id] = sortedItems.filter((item) => item.group_id === group.id);
      return acc;
    }, {}) || {};

  const visibleColumns = (board?.columns || []).filter((col) => !hiddenColumns?.has(col.id));

  if (isLoading && !board) {
    return (
      <div className="p-8 bg-[#F6F6F6] min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0E2E56] mx-auto mb-4"></div>
          <p className="text-lg text-[#1E1F21]">Loading board...</p>
        </div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="p-8 bg-[#F6F6F6] min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-16">
            <h2 className="text-2xl font-bold text-[#1E1F21] mb-4">Board not found</h2>
            <Link href={createPageUrl("Boards")}>
              <Button className="bg-[#0E2E56] hover:bg-[#163C6B] text-white rounded-lg">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Boards
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentSelectedCount = selectedItems?.size || 0;
  const numHiddenColumns = hiddenColumns?.size || 0;

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-full">
        <div className="sticky top-0 z-20 bg-background pb-2">
          <BoardHeader
            board={board}
            items={items}
            itemsCount={items.length}
            selectedCount={currentSelectedCount}
            currentView={currentView}
            onViewChange={handleViewChange}
            onShowAnalytics={() => setShowAnalytics(true)}
            onShowIntegrations={() => setShowIntegrations(true)}
            onShowAutomations={() => setShowAutomations(true)}
            onBoardUpdate={(updated) => setBoard(updated)}
            canEdit={canEdit}
          />
        </div>

        <div className="px-6 py-6">
          {currentView === "table" && (
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              {canEdit ? (
                <>
                  <button
                    onClick={() => setShowNewTaskModal(true)}
                    className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-3.5 py-2 rounded hover:bg-primary/90 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Task
                  </button>

                  <div className="w-px h-5 bg-border" />
                </>
              ) : (
                <>
                  {/* Filtering, sorting and the views all stay: this board is
                      readable, just not the viewer's to change. */}
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded px-2.5 py-1.5">
                    <Eye className="w-3.5 h-3.5" />
                    Read-only · shared by {board.created_by}
                  </span>

                  <div className="w-px h-5 bg-border" />
                </>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-52 h-8 text-sm bg-card border-border"
                />
              </div>

              <div className="w-px h-5 bg-border" />

              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                    onClick={() => setShowPersonFilter(!showPersonFilter)}
                  >
                    <Users className="w-3.5 h-3.5" />
                    Person
                    {filters.people.length > 0 && (
                      <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center font-medium">
                        {filters.people.length}
                      </span>
                    )}
                  </button>
                  {showPersonFilter && (
                    <PersonFilter
                      items={items}
                      selectedPeople={filters.people}
                      onChange={(people) => setFilters((prev) => ({ ...prev, people }))}
                      onClose={() => setShowPersonFilter(false)}
                    />
                  )}
                </div>

                <div className="relative">
                  <button
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                    onClick={() => setShowFilterPanel(!showFilterPanel)}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    Filter
                    {filters.status.length + (filters.priority?.length || 0) > 0 && (
                      <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center font-medium">
                        {filters.status.length + (filters.priority?.length || 0)}
                      </span>
                    )}
                  </button>
                  {showFilterPanel && (
                    <FilterPanel
                      filters={filters}
                      onChange={setFilters}
                      onClose={() => setShowFilterPanel(false)}
                      board={board}
                    />
                  )}
                </div>

                <div className="relative">
                  <button
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                    onClick={() => setShowSortMenu(!showSortMenu)}
                  >
                    <SortAsc className="w-3.5 h-3.5" />
                    Sort
                  </button>
                  {showSortMenu && (
                    <SortMenu
                      sortBy={sortBy}
                      sortDirection={sortDirection}
                      columns={board.columns}
                      onChange={(field, direction) => {
                        setSortBy(field);
                        setSortDirection(direction);
                      }}
                      onClose={() => setShowSortMenu(false)}
                    />
                  )}
                </div>

                <div className="relative">
                  <button
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                    onClick={() => setShowHideMenu(!showHideMenu)}
                  >
                    {numHiddenColumns > 0 ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                    Hide
                    {numHiddenColumns > 0 && (
                      <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center font-medium">
                        {numHiddenColumns}
                      </span>
                    )}
                  </button>
                  {showHideMenu && (
                    <HideMenu
                      columns={board.columns}
                      hiddenColumns={hiddenColumns}
                      onChange={setHiddenColumns}
                      onClose={() => setShowHideMenu(false)}
                    />
                  )}
                </div>

                <div className="relative">
                  <button
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded hover:bg-secondary transition-colors"
                    onClick={() => setShowGroupByMenu(!showGroupByMenu)}
                  >
                    <GroupIcon className="w-3.5 h-3.5" />
                    Group by
                  </button>
                  {showGroupByMenu && (
                    <GroupByMenu
                      groupBy={groupBy}
                      columns={board.columns}
                      onChange={setGroupBy}
                      onClose={() => setShowGroupByMenu(false)}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {currentView === "table" && (
            <DragDropContext onDragEnd={handleBoardDragEnd}>
              <div className="bg-card border border-border rounded overflow-hidden">
                {(board.groups || []).map((group) => (
                  <GroupSection
                    key={group.id}
                    group={group}
                    items={groupedItems[group.id] || []}
                    columns={visibleColumns}
                    onAddItem={handleAddItem}
                    onUpdateItem={handleUpdateItem}
                    onDeleteItem={handleDeleteItem}
                    onReorderItems={handleReorderItems}
                    onUpdateColumn={handleUpdateColumn}
                    onDeleteColumn={handleDeleteColumn}
                    onAddColumn={() => setShowNewColumnModal(true)}
                    onDeleteGroup={handleDeleteGroup}
                    onRenameGroup={handleRenameGroup}
                    onHideColumnFromGroup={handleHideColumnFromGroup}
                    isLoading={isLoading}
                  />
                ))}
                <div className="p-3 border-t border-border">
                  <button
                    className="w-full inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-foreground/30 rounded py-2 transition-colors"
                    onClick={() => setShowNewGroupModal(true)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add New Group
                  </button>
                </div>
              </div>
            </DragDropContext>
          )}

          {currentView === "kanban" && (
            <KanbanView
              board={board}
              items={sortedItems} // Pass sorted items
              onAddItem={handleAddItem}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
              onReorderItems={handleReorderItems}
            />
          )}

          {currentView === "timeline" && (
            <TimelineView
              board={board}
              items={sortedItems} // Pass sorted items
              onAddItem={handleAddItem}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
            />
          )}
        </div>

        <NewTaskModal
          isOpen={showNewTaskModal}
          onClose={() => setShowNewTaskModal(false)}
          board={board}
          onSubmit={handleAddItem}
        />
        <NewColumnModal
          isOpen={showNewColumnModal}
          onClose={() => setShowNewColumnModal(false)}
          onSubmit={handleAddColumn}
        />
        <NewGroupModal
          isOpen={showNewGroupModal}
          onClose={() => setShowNewGroupModal(false)}
          onSubmit={handleAddGroup}
        />

        {showAnalytics && (
          <AnalyticsPanel
            board={board}
            items={items} // Pass original items, panel will sort/filter if needed
            onClose={() => setShowAnalytics(false)}
          />
        )}

        {showIntegrations && (
          <IntegrationsPanel board={board} onClose={() => setShowIntegrations(false)} />
        )}

        {showAutomations && (
          <AutomationsPanel board={board} onClose={() => setShowAutomations(false)} />
        )}
      </div>
    </div>
  );
}

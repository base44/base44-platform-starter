import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Plus, Trash2, Pencil } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Droppable, Draggable } from "@hello-pangea/dnd";

import ItemRow from "./ItemRow";
import ColumnHeader from "./ColumnHeader";
import GroupSummary from "./GroupSummary";
import GroupSummaryRow from "./GroupSummaryRow"; // Assuming this new component exists

const DRAG_HANDLE_WIDTH = 24; // w-6
const CHECKBOX_WIDTH = 32; // w-8
const TASK_COLUMN_DEFAULT_WIDTH = 250; // Example width for Task column
const PRIORITY_COLUMN_DEFAULT_WIDTH = 120; // Width for Priority column
const DELETE_BUTTON_WIDTH = 50; // Changed to match ADD_COLUMN_WIDTH
const ADD_COLUMN_WIDTH = 50; // Add column button width

export default function GroupSection({
  group,
  items,
  columns, // These are all possible columns from the board
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onReorderItems,
  onUpdateColumn,
  onDeleteColumn, // This is still relevant for true column deletion (board-level)
  onAddColumn,
  isLoading,
  onDeleteGroup,
  onRenameGroup,
  onHideColumnFromGroup, // New prop for hiding column from specific group
}) {
  const [isCollapsed, setIsCollapsed] = useState(group.collapsed || false);

  useEffect(() => {
    setIsCollapsed(group.collapsed || false);
  }, [group.collapsed]);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [isRenamingGroup, setIsRenamingGroup] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState(group.title);

  useEffect(() => {
    setGroupTitleDraft(group.title);
  }, [group.title]);

  const handleAddItemLocal = async () => {
    if (newItemTitle.trim()) {
      await onAddItem(group.id, newItemTitle.trim());
      setNewItemTitle("");
      setIsAddingItem(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleAddItemLocal();
    } else if (e.key === "Escape") {
      setIsAddingItem(false);
      setNewItemTitle("");
    }
  };

  const handleRenameSubmit = () => {
    if (groupTitleDraft.trim() && groupTitleDraft.trim() !== group.title) {
      onRenameGroup(group.id, groupTitleDraft.trim());
    }
    setIsRenamingGroup(false);
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") {
      setGroupTitleDraft(group.title);
      setIsRenamingGroup(false);
    }
  };

  const handleDeleteGroupClick = (e) => {
    e.stopPropagation(); // Prevent group from collapsing/expanding
    if (
      window.confirm(
        `Are you sure you want to delete the group "${group.title}" and all its tasks? This cannot be undone.`,
      )
    ) {
      onDeleteGroup(group.id);
    }
  };

  // Get effective columns for this group (board columns filtered by visible_columns + custom columns)
  const getEffectiveColumns = () => {
    // If group.visible_columns is defined, filter columns based on it
    // BUT if it's undefined or empty, show ALL board columns by default
    const visibleBoardColumns =
      group.visible_columns && group.visible_columns.length > 0
        ? columns.filter((col) => group.visible_columns.includes(col.id))
        : columns; // Show all board columns if visible_columns is not set or empty

    // Merge with group-specific custom columns
    const customColumns = group.custom_columns || [];

    // Combine visible board columns and custom columns, ensuring uniqueness by ID
    const combinedColumns = [...visibleBoardColumns, ...customColumns];
    const uniqueColumnIds = new Set();
    const effectiveCols = [];
    for (const col of combinedColumns) {
      if (!uniqueColumnIds.has(col.id)) {
        uniqueColumnIds.add(col.id);
        effectiveCols.push(col);
      }
    }
    return effectiveCols;
  };

  const effectiveColumns = getEffectiveColumns();
  const taskColumn = effectiveColumns.find((col) => col.id === "task");
  const taskColumnWidth = taskColumn?.width || TASK_COLUMN_DEFAULT_WIDTH;

  const priorityColumn = effectiveColumns.find((col) => col.type === "priority");
  const priorityColumnWidth = priorityColumn?.width || PRIORITY_COLUMN_DEFAULT_WIDTH;

  // Calculate minimum width needed for all effective columns
  const columnsWidth = effectiveColumns.reduce((total, col) => total + (col.width || 150), 0);
  const totalMinWidth = DRAG_HANDLE_WIDTH + CHECKBOX_WIDTH + columnsWidth + ADD_COLUMN_WIDTH; // Removed DELETE_BUTTON_WIDTH from here as it's part of the "add column" space now.

  const handleHideColumn = (columnId) => {
    // Hide column from this specific group
    onHideColumnFromGroup(group.id, columnId);
  };

  return (
    <div className="border-b border-[#EDEDED] last:border-b-0">
      {/* Group Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#F6F6F6] transition-colors relative"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{ borderLeft: `4px solid ${group.color}` }}
      >
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-[#EDEDED]">
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
          {isRenamingGroup ? (
            <Input
              value={groupTitleDraft}
              onChange={(e) => setGroupTitleDraft(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameSubmit}
              onClick={(e) => e.stopPropagation()}
              className="h-7 text-base font-bold border-[#0E2E56]/40 focus:ring-1 focus:ring-[#0E2E56]/30 w-48"
              autoFocus
            />
          ) : (
            <h3
              className="font-bold text-[#1E1F21] text-lg cursor-text hover:underline decoration-dotted underline-offset-2"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsRenamingGroup(true);
              }}
              title="Double-click to rename"
            >
              {group.title}
            </h3>
          )}
          <span className="text-sm text-[#6D6E6F]">({items.length})</span>
        </div>

        <div className="flex items-center gap-2">
          <GroupSummary items={items} columns={columns} />{" "}
          {/* Still uses original columns for overall summary */}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-[#EDEDED] text-muted-foreground opacity-50 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setGroupTitleDraft(group.title);
              setIsRenamingGroup(true);
            }}
            title="Rename group"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:bg-red-100 text-red-500 hover:text-red-600 opacity-50 hover:opacity-100 transition-opacity"
            onClick={handleDeleteGroupClick}
            title="Delete group"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Table Area */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto relative">
              {" "}
              {/* Horizontal scroll container */}
              {/* Column Headers */}
              <div
                className="flex bg-[#F6F6F6] border-b border-[#EDEDED] sticky top-0 z-10"
                style={{ minWidth: `${totalMinWidth}px` }} // Ensure minimum width
              >
                {/* Sticky Left: Drag Handle */}
                <div
                  className="flex-shrink-0 bg-[#F6F6F6]" // Sticky background for drag handle
                  style={{ width: DRAG_HANDLE_WIDTH, position: "sticky", left: 0, zIndex: 2 }}
                />

                {/* Sticky Left: Checkbox */}
                <div
                  className="flex-shrink-0 bg-[#F6F6F6]" // Sticky background for checkbox
                  style={{
                    width: CHECKBOX_WIDTH,
                    position: "sticky",
                    left: DRAG_HANDLE_WIDTH,
                    zIndex: 2,
                  }}
                />

                {/* Draggable Column Headers */}
                <Droppable droppableId={`columns-${group.id}`} direction="horizontal" type="COLUMN">
                  {(colProvided) => (
                    <div
                      ref={colProvided.innerRef}
                      {...colProvided.droppableProps}
                      className="flex"
                    >
                      {effectiveColumns.map((column, colIndex) => {
                        const isTask = column.id === "task";
                        const isPriority = column.type === "priority";
                        let stickyProps = {};
                        if (isTask) {
                          stickyProps = {
                            position: "sticky",
                            left: DRAG_HANDLE_WIDTH + CHECKBOX_WIDTH,
                            zIndex: 2,
                            backgroundColor: "#F6F6F6",
                            width: taskColumnWidth,
                            minWidth: taskColumnWidth,
                          };
                        } else if (isPriority) {
                          stickyProps = {
                            position: "sticky",
                            left: DRAG_HANDLE_WIDTH + CHECKBOX_WIDTH + taskColumnWidth,
                            zIndex: 2,
                            backgroundColor: "#F6F6F6",
                            width: priorityColumnWidth,
                            minWidth: priorityColumnWidth,
                          };
                        }
                        return (
                          <Draggable
                            key={column.id}
                            draggableId={`col-${column.id}`}
                            index={colIndex}
                          >
                            {(dragCol, dragColSnap) => (
                              <div
                                ref={dragCol.innerRef}
                                {...dragCol.draggableProps}
                                {...dragCol.dragHandleProps}
                                style={{
                                  ...dragCol.draggableProps.style,
                                  opacity: dragColSnap.isDragging ? 0.7 : 1,
                                  cursor: dragColSnap.isDragging ? "grabbing" : "grab",
                                }}
                              >
                                <ColumnHeader
                                  column={column}
                                  onUpdateColumn={onUpdateColumn}
                                  onDeleteColumn={handleHideColumn}
                                  style={stickyProps}
                                  groupId={group.id}
                                />
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {colProvided.placeholder}
                    </div>
                  )}
                </Droppable>

                {/* Flexible spacer to push add column and delete button to edges */}
                <div className="flex-1 min-w-0 bg-[#F6F6F6]" />

                {/* Add Column Button / Delete Header Space - This div will be sticky right */}
                <div
                  className="flex items-center justify-center px-3 py-3 border-l border-[#E1F3] hover:bg-white transition-colors cursor-pointer bg-[#F6F6F6] flex-shrink-0"
                  style={{
                    width: ADD_COLUMN_WIDTH,
                    position: "sticky",
                    right: 0,
                    zIndex: 2, // Ensure it's above content
                  }}
                  onClick={onAddColumn}
                  title="Add new column"
                >
                  <Plus className="w-4 h-4 text-[#0E2E56]" />
                </div>
              </div>
              {/* Items */}
              <div>
                {isLoading ? (
                  <div className="p-8 text-center text-[#6D6E6F]">Loading items...</div>
                ) : items.length === 0 && !isAddingItem ? (
                  <div className="p-8 text-center">
                    <p className="text-[#6D6E6F] mb-4">No items in this group</p>
                    <Button
                      onClick={() => setIsAddingItem(true)}
                      variant="outline"
                      className="border-[#EDEDED] rounded-lg"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Item
                    </Button>
                  </div>
                ) : (
                  <Droppable droppableId={group.id}>
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps}>
                        {items.map((item, index) => (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <ItemRow
                                key={item.id}
                                item={item}
                                columns={effectiveColumns}
                                onUpdate={onUpdateItem}
                                onDelete={onDeleteItem}
                                draggableProvided={dragProvided}
                                isDragging={dragSnapshot.isDragging}
                                taskColumnWidth={taskColumnWidth}
                                priorityColumnWidth={priorityColumnWidth}
                                dragHandleWidth={DRAG_HANDLE_WIDTH}
                                checkboxWidth={CHECKBOX_WIDTH}
                                totalMinWidth={totalMinWidth}
                              />
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {isAddingItem && (
                          <div className="flex items-center gap-2 px-4 py-2 border-b border-[#EDEDED]">
                            <Input
                              autoFocus
                              value={newItemTitle}
                              onChange={(e) => setNewItemTitle(e.target.value)}
                              onKeyDown={handleKeyPress}
                              placeholder="Item name..."
                              className="h-7 text-sm border-[#0E2E56]/40 focus:ring-1 focus:ring-[#0E2E56]/30"
                            />
                            <Button
                              size="sm"
                              onClick={handleAddItemLocal}
                              className="bg-[#0E2E56] text-white hover:bg-[#163C6B] h-7 px-3"
                            >
                              Add
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setIsAddingItem(false);
                                setNewItemTitle("");
                              }}
                              className="h-7 px-3"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </Droppable>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, CalendarDays, MoreHorizontal, Users, List, Sparkles } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { format } from "date-fns";

import TaskEditModal from "../TaskEditModal";

// Helper functions
const getStatusColumns = (board) => {
  return board?.columns?.filter((col) => col.type === "status") || [];
};

const getPeopleColumns = (board) => {
  return board?.columns?.filter((col) => col.type === "people") || [];
};

const getUniqueValues = (items, columnId) => {
  const values = items.map((item) => item.data?.[columnId]).filter(Boolean);
  return [...new Set(values)];
};

// Standard status colors - consistent with the rest of the system
const getStandardStatusColors = () => ({
  "Not Started": "#C4C4C4",
  "Working on it": "#F1BD6C",
  Done: "#5DA283",
  Stuck: "#F06A6A",
});

// Color palettes for people grouping
const peopleColorPalette = [
  "#6C5CE7",
  "#A29BFE",
  "#FD79A8",
  "#E17055",
  "#00B894",
  "#0984E3",
  "#6C5CE7",
  "#FDCB6E",
];

const getRandomGradient = (index) => {
  const gradients = [
    "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
    "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
    "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
    "linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)",
    "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
    "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  ];
  return gradients[index % gradients.length];
};

const KanbanCard = ({ item, index, board, groupingType, onEdit }) => {
  const priorityColumn = board?.columns?.find((col) => col.type === "priority");
  const priorityValue = item.data?.[priorityColumn?.id];
  const priorityOption = priorityColumn?.options?.choices?.find((c) => c.value === priorityValue);

  const ownerColumn = board?.columns?.find((col) => col.type === "people");
  const ownerValue = item.data?.[ownerColumn?.id];

  const statusColumn = board?.columns?.find((col) => col.type === "status");
  const statusValue = item.data?.[statusColumn?.id];
  const statusOption = statusColumn?.options?.choices?.find((c) => c.label === statusValue);

  const dueDateColumn = board?.columns?.find(
    (col) =>
      col.type === "date" &&
      (col.id.toLowerCase().includes("due") || col.title.toLowerCase().includes("due")),
  );
  const dueDateValue = item.data?.[dueDateColumn?.id];

  // Determine card accent color based on grouping
  const getCardAccentColor = () => {
    if (groupingType === "status" && priorityOption) {
      return priorityOption.color;
    } else if (groupingType === "people" && statusOption) {
      return statusOption.color;
    }
    return "#EDEDED";
  };

  return (
    <Draggable draggableId={`item-${item.id}`} index={index} key={`item-${item.id}`}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`relative p-4 mb-4 bg-white rounded-xl shadow-lg border-l-4 hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer ${snapshot.isDragging ? "shadow-2xl ring-4 ring-blue-200 scale-105" : ""}`}
          style={{
            borderLeftColor: getCardAccentColor(),
            background: snapshot.isDragging
              ? "linear-gradient(135deg, #ffffff 0%, #f8faff 100%)"
              : "white",
            ...provided.draggableProps.style,
          }}
          onClick={(e) => {
            if (snapshot.isDragging) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            onEdit(item);
          }}
        >
          {/* Sparkle decoration for dragging */}
          {snapshot.isDragging && (
            <div className="absolute -top-2 -right-2">
              <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
            </div>
          )}

          <div className="flex justify-between items-start mb-3">
            <h4 className="font-bold text-lg text-gray-800 leading-tight pr-2">{item.title}</h4>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item);
              }}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </div>

          {/* Tags row */}
          <div className="flex flex-wrap gap-2 mb-3">
            {groupingType === "people" && statusOption && (
              <span
                className="px-3 py-1 text-xs font-semibold rounded-full shadow-sm"
                style={{
                  backgroundColor: `${statusOption.color}20`,
                  color: statusOption.color,
                  border: `1px solid ${statusOption.color}40`,
                }}
              >
                {statusOption.label}
              </span>
            )}

            {groupingType === "status" && priorityOption && (
              <span
                className="px-3 py-1 text-xs font-semibold rounded-full shadow-sm"
                style={{
                  backgroundColor: `${priorityOption.color}20`,
                  color: priorityOption.color,
                  border: `1px solid ${priorityOption.color}40`,
                }}
              >
                {priorityOption.label}
              </span>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-gray-500 mt-4 pt-3 border-t border-gray-100">
            <div className="flex items-center gap-3">
              {dueDateValue && (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-full">
                  <CalendarDays className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-blue-700 font-medium">
                    {format(new Date(dueDateValue), "MMM d")}
                  </span>
                </div>
              )}
            </div>

            {ownerValue && (
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full text-white font-bold text-sm shadow-md"
                style={{ background: getRandomGradient(ownerValue.charCodeAt(0)) }}
                title={ownerValue}
              >
                {ownerValue.substring(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
};

export default function KanbanView({ board, items, onUpdateItem, onDeleteItem, onReorderItems }) {
  const [groupBy, setGroupBy] = useState("status");
  const [editingTask, setEditingTask] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  if (!board)
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="animate-pulse">Board data not available.</div>
      </div>
    );

  // Get available grouping options
  const statusColumnsDef = getStatusColumns(board);
  const peopleColumnsDef = getPeopleColumns(board);

  const canGroupByStatus = statusColumnsDef.length > 0;
  const canGroupByPeople = peopleColumnsDef.length > 0;

  if (!canGroupByStatus && !canGroupByPeople) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="max-w-md mx-auto">
          <h3 className="text-xl font-semibold mb-2">Kanban view requires grouping columns</h3>
          <p>Please add either a 'Status' or 'People' type column to enable Kanban view.</p>
        </div>
      </div>
    );
  }

  if (groupBy === "status" && !canGroupByStatus) {
    setGroupBy("people");
  } else if (groupBy === "people" && !canGroupByPeople) {
    setGroupBy("status");
  }

  const activeColumnDefinition = groupBy === "status" ? statusColumnsDef[0] : peopleColumnsDef[0];

  if (!activeColumnDefinition)
    return (
      <div className="p-4 text-center text-gray-500">
        No suitable column definition found for grouping.
      </div>
    );

  let columnsData = [];

  if (groupBy === "status" && activeColumnDefinition.options?.choices) {
    const standardColors = getStandardStatusColors();
    columnsData = activeColumnDefinition.options.choices.map((choice, index) => ({
      id: `status-${choice.label}`,
      title: choice.label,
      color: standardColors[choice.label] || choice.color || "#666666",
      gradient: getRandomGradient(index),
      items: items
        .filter((item) => item.data?.[activeColumnDefinition.id] === choice.label)
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
    }));
  } else if (groupBy === "people") {
    const uniquePeople = getUniqueValues(items, activeColumnDefinition.id);

    // Create columns for people with assigned tasks
    columnsData = uniquePeople.map((person, index) => ({
      id: `people-${person}`,
      title: person,
      color: peopleColorPalette[index % peopleColorPalette.length],
      gradient: getRandomGradient(index),
      items: items
        .filter((item) => item.data?.[activeColumnDefinition.id] === person)
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0)),
    }));

    // Add column for unassigned tasks
    const unassignedItems = items
      .filter(
        (item) =>
          !item.data?.[activeColumnDefinition.id] ||
          item.data[activeColumnDefinition.id] === "" ||
          item.data[activeColumnDefinition.id] === null,
      )
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (unassignedItems.length > 0 || uniquePeople.length === 0) {
      columnsData.unshift({
        id: "people-unassigned",
        title: "Unassigned",
        color: "#9CA3AF", // Gray color for unassigned
        gradient: "linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)",
        items: unassignedItems,
      });
    }
  }

  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;

    if (!destination) return;

    // Extract actual item ID from draggableId
    const itemId = draggableId.replace("item-", "");
    const itemToMove = items.find((i) => i.id.toString() === itemId);

    if (!itemToMove) {
      console.error("Item to move not found:", itemId);
      return;
    }

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    if (source.droppableId === destination.droppableId) {
      // Reordering within same column
      const column = columnsData.find((col) => col.id === source.droppableId);
      if (!column) return;

      const currentItems = [...column.items];
      const [reorderedItem] = currentItems.splice(source.index, 1);
      currentItems.splice(destination.index, 0, reorderedItem);

      // Update order_index for all items in this column
      currentItems.forEach((item, index) =>
        onUpdateItem(item.id, {
          order_index: index,
        }),
      );
    } else {
      // Moving between columns - this is where we change status/person
      const updatedData = { ...itemToMove.data };

      // Extract the actual value from destination droppableId
      let newValue;
      if (destination.droppableId.startsWith("status-")) {
        newValue = destination.droppableId.replace("status-", "");
      } else if (destination.droppableId === "people-unassigned") {
        newValue = null; // or empty string, depending on your preference
      } else {
        newValue = destination.droppableId.replace("people-", "");
      }

      updatedData[activeColumnDefinition.id] = newValue;

      // Find destination column's items to determine new order_index
      const destColumn = columnsData.find((col) => col.id === destination.droppableId);
      if (!destColumn) return;

      const tempDestItems = [...destColumn.items];
      const existingItemIndex = tempDestItems.findIndex((i) => i.id === itemToMove.id);
      if (existingItemIndex !== -1) tempDestItems.splice(existingItemIndex, 1);

      tempDestItems.splice(destination.index, 0, { ...itemToMove, data: updatedData });

      const newOrderIndex = tempDestItems.findIndex((i) => i.id === itemToMove.id);

      onUpdateItem(itemToMove.id, {
        data: updatedData,
        order_index: newOrderIndex,
      });

      // Re-calculate order_index for items in the source column
      const sourceColumn = columnsData.find((col) => col.id === source.droppableId);
      if (sourceColumn) {
        const tempSourceItems = [...sourceColumn.items].filter((i) => i.id !== itemToMove.id);
        tempSourceItems.forEach((item, index) => {
          if (item.order_index !== index) {
            onUpdateItem(item.id, { order_index: index });
          }
        });
      }
    }
  };

  const handleEditTask = (task) => {
    setEditingTask(task);
    setShowEditModal(true);
  };

  const handleUpdateTask = (taskId, updates) => {
    onUpdateItem(taskId, updates);
    setShowEditModal(false);
    setEditingTask(null);
  };

  const handleDeleteTask = (taskId) => {
    onDeleteItem(taskId);
    setShowEditModal(false);
    setEditingTask(null);
  };

  return (
    <div className="h-full">
      {/* Header with grouping selector */}
      <div className="flex items-center justify-between mb-6 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
            <MoreHorizontal className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Kanban Board</h2>
            <p className="text-sm text-gray-600">Drag and drop to manage your tasks</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Group by:</span>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-32 bg-white border-2 border-gray-200 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {canGroupByStatus && (
                <SelectItem value="status">
                  <div className="flex items-center gap-2">
                    <List className="w-4 h-4" />
                    Status
                  </div>
                </SelectItem>
              )}
              {canGroupByPeople && (
                <SelectItem value="people">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    People
                  </div>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Kanban Columns */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-6 overflow-x-auto p-2 pb-8">
          {columnsData.map((column, columnIndex) => (
            <Droppable key={column.id} droppableId={column.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`w-80 flex-shrink-0 rounded-xl p-2 transition-all duration-300 ${snapshot.isDraggingOver ? "shadow-2xl scale-105" : "shadow-lg"}`}
                  style={{
                    background: snapshot.isDraggingOver
                      ? `linear-gradient(135deg, ${column.color}20 0%, ${column.color}10 100%)`
                      : "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
                  }}
                >
                  {/* Column Header */}
                  <div className="px-4 py-3 mb-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <h3 className="font-bold text-lg text-gray-800">
                          {column.title}
                          {column.id === "people-unassigned" && (
                            <span className="text-sm font-normal text-gray-500 ml-1">
                              (No one assigned)
                            </span>
                          )}
                        </h3>
                        <span
                          className="px-2.5 py-1 text-sm font-bold rounded-full shadow-sm"
                          style={{
                            backgroundColor: `${column.color}20`,
                            color: column.color,
                          }}
                        >
                          {column.items.length}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full hover:bg-white/50"
                      >
                        <Plus className="w-5 h-5" style={{ color: column.color }} />
                      </Button>
                    </div>
                  </div>

                  {/* Column Content */}
                  <div className="px-2 pb-2 min-h-[200px] max-h-[calc(100vh-300px)] overflow-y-auto custom-scrollbar group">
                    {column.items.length === 0 && !snapshot.isDraggingOver && (
                      <div className="text-center py-12 px-4">
                        <div
                          className="border-3 border-dashed rounded-xl py-8 px-4 transition-colors"
                          style={{ borderColor: `${column.color}40` }}
                        >
                          <div
                            className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                            style={{ backgroundColor: `${column.color}20` }}
                          >
                            <Plus className="w-6 h-6" style={{ color: column.color }} />
                          </div>
                          <p className="text-sm font-medium" style={{ color: column.color }}>
                            {column.id === "people-unassigned"
                              ? "Drag unassigned tasks here"
                              : "Drag tasks here"}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">or click + to add new</p>
                        </div>
                      </div>
                    )}
                    {column.items.map((item, index) => (
                      <KanbanCard
                        key={`item-${item.id}`}
                        item={item}
                        index={index}
                        board={board}
                        groupingType={groupBy}
                        onEdit={handleEditTask}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {/* Task Edit Modal */}
      <TaskEditModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingTask(null);
        }}
        task={editingTask}
        board={board}
        onUpdate={handleUpdateTask}
        onDelete={handleDeleteTask}
      />
    </div>
  );
}

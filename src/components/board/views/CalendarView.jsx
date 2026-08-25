import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
} from "date-fns";

import TaskEditModal from "../TaskEditModal";

const CalendarEvent = ({ item, board, onEdit }) => {
  const priorityColumn = board?.columns?.find((col) => col.type === "priority");
  const priorityValue = item.data?.[priorityColumn?.id];
  const priorityOption = priorityColumn?.options?.choices?.find((c) => c.value === priorityValue);

  return (
    <div
      className="p-1.5 mb-1 bg-white rounded-md shadow-sm border border-[#EDEDED] hover:bg-gray-50 cursor-pointer transition-all duration-200 hover:shadow-md hover:scale-105"
      title={item.title}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(item);
      }}
    >
      <div className="flex items-center gap-1.5">
        {priorityOption && (
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: priorityOption.color || "#ccc" }}
          />
        )}
        <p className="text-xs font-medium text-[#1E1F21] truncate">{item.title}</p>
      </div>
    </div>
  );
};

export default function CalendarView({ board, items, onUpdateItem, onDeleteItem }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [dateColumnId, setDateColumnId] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    // Try to find a 'date' type column to use for events
    const dateCol = board?.columns?.find((col) => col.type === "date");
    if (dateCol) {
      setDateColumnId(dateCol.id);
    } else {
      // If no 'date' column, try to find 'due_date' (common default)
      const dueDateCol = board?.columns?.find((col) => col.id === "due_date");
      if (dueDateCol && dueDateCol.type === "date") {
        setDateColumnId(dueDateCol.id);
      }
    }
  }, [board]);

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

  const renderHeader = () => {
    return (
      <div className="flex justify-between items-center mb-4 px-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-xl font-semibold text-[#1E1F21]">
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    );
  };

  const renderDays = () => {
    const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return (
      <div className="grid grid-cols-7 text-center text-xs font-medium text-[#6D6E6F] mb-2">
        {daysOfWeek.map((day) => (
          <div key={day} className="py-2 border-b">
            {day}
          </div>
        ))}
      </div>
    );
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const today = new Date();

    return (
      <div className="grid grid-cols-7 grid-rows-5 gap-px">
        {days.map((day) => (
          <div
            key={day.toString()}
            className={`p-2 border border-[#EDEDED] min-h-[100px] relative transition-colors hover:bg-[#F6F6F6]
              ${!isSameMonth(day, monthStart) ? "bg-[#F6F6F6] text-gray-400" : "bg-white"}
              ${isSameDay(day, today) ? "ring-2 ring-[#0E2E56] ring-inset" : ""}
            `}
          >
            <span
              className={`text-xs font-medium ${isSameDay(day, today) ? "text-[#0E2E56]" : ""}`}
            >
              {format(day, "d")}
            </span>
            <div className="mt-1 space-y-1 overflow-y-auto max-h-[70px]">
              {dateColumnId &&
                items
                  .filter(
                    (item) =>
                      item.data?.[dateColumnId] &&
                      isSameDay(new Date(item.data[dateColumnId]), day),
                  )
                  .map((item) => (
                    <CalendarEvent
                      key={item.id}
                      item={item}
                      board={board}
                      onEdit={handleEditTask}
                    />
                  ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (!board) return <div className="p-4 text-center text-gray-500">Board data not available.</div>;

  if (!dateColumnId) {
    return (
      <div className="p-8 text-center text-gray-500">
        No suitable date column found for Calendar view. Please add a 'Date' type column to your
        board.
      </div>
    );
  }

  return (
    <>
      <Card className="shadow-lg border-[#EDEDED]">
        <CardContent className="p-4">
          {renderHeader()}
          {renderDays()}
          {renderCells()}
        </CardContent>
      </Card>

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
    </>
  );
}

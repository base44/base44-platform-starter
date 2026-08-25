import { Board, Item } from "@/lib/entityClient";
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isPast,
} from "date-fns";
import { motion } from "framer-motion";

export default function CalendarModal({ isOpen, onClose }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items, setItems] = useState([]);
  const [boards, setBoards] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadCalendarData();
    }
  }, [isOpen]);

  const loadCalendarData = async () => {
    setIsLoading(true);
    try {
      const [itemsData, boardsData] = await Promise.all([
        Item.list("-updated_date"),
        Board.list("-updated_date"),
      ]);
      setItems(itemsData);
      setBoards(boardsData);
    } catch (error) {
      console.error("Error loading calendar data:", error);
    }
    setIsLoading(false);
  };

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get items with due dates
  const getItemsForDate = (date) => {
    return items.filter((item) => {
      const board = boards.find((b) => b.id === item.board_id);
      const dueDateColumn = board?.columns?.find((col) => col.type === "date");
      const dueDate = item.data?.[dueDateColumn?.id];

      if (!dueDate) return false;
      return isSameDay(new Date(dueDate), date);
    });
  };

  const getItemStatus = (item) => {
    const board = boards.find((b) => b.id === item.board_id);
    const statusColumn = board?.columns?.find((col) => col.type === "status");
    return item.data?.[statusColumn?.id] || "Not Started";
  };

  const isOverdue = (item, date) => {
    const status = getItemStatus(item);
    return isPast(date) && status !== "Done" && !isToday(date);
  };

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));
  };

  const selectedDateItems = selectedDate ? getItemsForDate(selectedDate) : [];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#1E1F21] flex items-center gap-2">
            <CalendarIcon className="w-6 h-6 text-[#0E2E56]" />
            Calendar Overview
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-[#1E1F21]">{format(currentDate, "MMMM yyyy")}</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={previousMonth}
                className="h-8 w-8 rounded-lg"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={nextMonth}
                className="h-8 w-8 rounded-lg"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {/* Calendar Grid */}
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="p-2 text-center text-sm font-medium text-[#6D6E6F]">
                {day}
              </div>
            ))}

            {monthDays.map((date, index) => {
              const dayItems = getItemsForDate(date);
              const hasOverdue = dayItems.some((item) => isOverdue(item, date));
              const isSelected = selectedDate && isSameDay(date, selectedDate);

              return (
                <motion.div
                  key={date.toISOString()}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.01 }}
                  className={`
                    relative p-2 min-h-[60px] border rounded-lg cursor-pointer transition-all hover:shadow-md
                    ${isSameMonth(date, currentDate) ? "bg-white border-[#EDEDED]" : "bg-gray-50 border-gray-200"}
                    ${isToday(date) ? "ring-2 ring-[#0E2E56] ring-opacity-50" : ""}
                    ${isSelected ? "bg-[#0E2E56] text-white" : ""}
                    ${hasOverdue ? "border-red-300 bg-red-50" : ""}
                  `}
                  onClick={() => setSelectedDate(date)}
                >
                  <div
                    className={`text-sm font-medium mb-1 ${isSelected ? "text-white" : isToday(date) ? "text-[#0E2E56]" : "text-[#1E1F21]"}`}
                  >
                    {format(date, "d")}
                  </div>

                  {dayItems.length > 0 && (
                    <div className="space-y-1">
                      {dayItems.slice(0, 2).map((item, itemIndex) => {
                        const status = getItemStatus(item);
                        const board = boards.find((b) => b.id === item.board_id);
                        const isItemOverdue = isOverdue(item, date);

                        return (
                          <div
                            key={item.id}
                            className={`text-xs p-1 rounded truncate ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : isItemOverdue
                                  ? "bg-red-100 text-red-800"
                                  : "bg-[#F6F6F6] text-[#1E1F21]"
                            }`}
                            title={item.title}
                          >
                            {item.title}
                          </div>
                        );
                      })}
                      {dayItems.length > 2 && (
                        <div
                          className={`text-xs ${isSelected ? "text-white/80" : "text-[#6D6E6F]"}`}
                        >
                          +{dayItems.length - 2} more
                        </div>
                      )}
                    </div>
                  )}

                  {hasOverdue && (
                    <AlertCircle className="absolute top-1 right-1 w-3 h-3 text-red-500" />
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Selected Date Details */}
          {selectedDate && selectedDateItems.length > 0 && (
            <div className="mt-6 p-4 bg-[#F6F6F6] rounded-lg">
              <h4 className="font-bold text-[#1E1F21] mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                {format(selectedDate, "EEEE, MMMM d, yyyy")} ({selectedDateItems.length} tasks)
              </h4>
              <div className="space-y-2">
                {selectedDateItems.map((item) => {
                  const status = getItemStatus(item);
                  const board = boards.find((b) => b.id === item.board_id);
                  const isItemOverdue = isOverdue(item, selectedDate);

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 bg-white rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: board?.color || "#0E2E56" }}
                        />
                        <div>
                          <p className="font-medium text-[#1E1F21]">{item.title}</p>
                          <p className="text-sm text-[#6D6E6F]">{board?.title}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isItemOverdue && (
                          <Badge className="bg-red-100 text-red-800 border-red-200">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Overdue
                          </Badge>
                        )}
                        <Badge variant="outline">{status}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={onClose}
            className="bg-[#0E2E56] hover:bg-[#163C6B] text-white rounded-lg h-10 px-6"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

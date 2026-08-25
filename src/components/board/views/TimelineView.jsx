import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  differenceInDays,
  isWithinInterval,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
} from "date-fns";

const TIMELINE_ITEM_HEIGHT = 32; // px
const DAY_CELL_WIDTH = 40; // px

const TimelineItemBar = ({ item, board, startDate, endDate, timelineStartDate, zoomLevel }) => {
  const itemStartDateStr = item.data?.startDate; // Assuming 'startDate' column exists
  const itemEndDateStr = item.data?.endDate || item.data?.due_date; // Assuming 'endDate' or 'due_date' column

  if (!itemStartDateStr || !itemEndDateStr) return null;

  const itemStart = new Date(itemStartDateStr);
  const itemEnd = new Date(itemEndDateStr);

  // Ensure dates are valid
  if (isNaN(itemStart.getTime()) || isNaN(itemEnd.getTime())) return null;

  // Ensure itemStart is before or same as itemEnd
  const displayStart = itemStart > itemEnd ? itemEnd : itemStart;
  const displayEnd = itemStart > itemEnd ? itemStart : itemEnd;

  // Check if the item falls within the current timeline view
  if (
    !isWithinInterval(displayStart, { start: timelineStartDate, end: endDate }) &&
    !isWithinInterval(displayEnd, { start: timelineStartDate, end: endDate }) &&
    !(displayStart < timelineStartDate && displayEnd > endDate)
  ) {
    return null;
  }

  const offsetDays = Math.max(0, differenceInDays(displayStart, timelineStartDate));
  let durationDays = differenceInDays(displayEnd, displayStart) + 1;

  // Adjust duration if item extends beyond timeline view
  if (displayStart < timelineStartDate) {
    durationDays = differenceInDays(displayEnd, timelineStartDate) + 1;
  }
  if (displayEnd > endDate) {
    durationDays =
      differenceInDays(
        endDate,
        displayStart < timelineStartDate ? timelineStartDate : displayStart,
      ) + 1;
  }
  durationDays = Math.max(1, durationDays); // Minimum 1 day width

  const left =
    offsetDays *
    DAY_CELL_WIDTH *
    (zoomLevel === "week" ? 1 : zoomLevel === "month" ? 30 / 7 : 1 / 7); // Adjust width based on zoom
  const width =
    durationDays *
      DAY_CELL_WIDTH *
      (zoomLevel === "week" ? 1 : zoomLevel === "month" ? 30 / 7 : 1 / 7) -
    4; // -4 for padding/margin

  const priorityColumn = board?.columns?.find((col) => col.type === "priority");
  const priorityValue = item.data?.[priorityColumn?.id];
  const priorityOption = priorityColumn?.options?.choices?.find((c) => c.value === priorityValue);
  const barColor = priorityOption?.color || board?.color || "#0E2E56";

  return (
    <div
      className="absolute h-[28px] rounded flex items-center px-2 text-white text-xs font-medium truncate shadow-sm"
      style={{
        left: `${left}px`,
        width: `${width}px`,
        top: "2px", // Small offset from top of row
        backgroundColor: barColor,
        opacity: 0.9,
      }}
      title={`${item.title} (${format(displayStart, "MMM d")} - ${format(displayEnd, "MMM d")})`}
    >
      {item.title}
    </div>
  );
};

export default function TimelineView({ board, items }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [zoomLevel, setZoomLevel] = useState("week"); // 'day', 'week', 'month'
  const [startDateColId, setStartDateColId] = useState(null);
  const [endDateColId, setEndDateColId] = useState(null);

  useEffect(() => {
    const dateCols = board?.columns?.filter((col) => col.type === "date");
    if (dateCols?.length >= 2) {
      setStartDateColId(dateCols[0].id); // Default to first date column
      setEndDateColId(dateCols[1].id); // Default to second date column
    } else if (dateCols?.length === 1) {
      setStartDateColId(dateCols[0].id);
      setEndDateColId(dateCols[0].id); // Use same for start/end if only one
    } else {
      // Fallback to common names if no 'date' type columns
      const sDate = board?.columns?.find(
        (c) => c.id === "startDate" || c.title.toLowerCase().includes("start"),
      )?.id;
      const eDate = board?.columns?.find(
        (c) =>
          c.id === "endDate" ||
          c.id === "due_date" ||
          c.title.toLowerCase().includes("end") ||
          c.title.toLowerCase().includes("due"),
      )?.id;
      if (sDate) setStartDateColId(sDate);
      if (eDate) setEndDateColId(eDate);
    }
  }, [board]);

  const { timelineStartDate, timelineEndDate, daysHeader } = useMemo(() => {
    let start, end;
    if (zoomLevel === "day") {
      start = currentDate;
      end = addDays(currentDate, 6); // Show 7 days
    } else if (zoomLevel === "week") {
      start = startOfWeek(currentDate, { weekStartsOn: 1 }); // Monday
      end = endOfWeek(currentDate, { weekStartsOn: 1 });
    } else {
      // month
      start = startOfMonth(currentDate);
      end = endOfMonth(currentDate);
    }
    const days = eachDayOfInterval({ start, end });
    return { timelineStartDate: start, timelineEndDate: end, daysHeader: days };
  }, [currentDate, zoomLevel]);

  const handlePrev = () => {
    if (zoomLevel === "day") setCurrentDate(subDays(currentDate, 7));
    else if (zoomLevel === "week") setCurrentDate(subDays(currentDate, 7));
    else setCurrentDate(subMonths(currentDate, 1));
  };

  const handleNext = () => {
    if (zoomLevel === "day") setCurrentDate(addDays(currentDate, 7));
    else if (zoomLevel === "week") setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addMonths(currentDate, 1));
  };

  const getHeaderLabel = () => {
    if (zoomLevel === "day")
      return `${format(timelineStartDate, "MMM d")} - ${format(timelineEndDate, "MMM d, yyyy")}`;
    if (zoomLevel === "week") return `Week of ${format(timelineStartDate, "MMM d, yyyy")}`;
    return format(currentDate, "MMMM yyyy");
  };

  if (!board) return <div className="p-4 text-center text-gray-500">Board data not available.</div>;

  if (!startDateColId || !endDateColId) {
    return (
      <div className="p-8 text-center text-gray-500">
        Timeline view requires at least one date-type column (ideally two for start/end dates).
        Please ensure your board has columns named 'startDate' and 'endDate' (or 'due_date'), or
        date-type columns.
      </div>
    );
  }

  // Group items for display (e.g., by original group or flat list)
  // For simplicity, using a flat list of items here. Grouping can be added.
  const displayItems = items.filter(
    (item) => item.data?.[startDateColId] && item.data?.[endDateColId || startDateColId],
  );

  return (
    <Card className="shadow-lg border-[#EDEDED] overflow-hidden">
      <CardHeader className="p-3 border-b flex flex-row items-center justify-between sticky top-0 bg-white z-10">
        <CardTitle className="text-base font-semibold text-[#1E1F21]">{getHeaderLabel()}</CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrev}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setCurrentDate(new Date())}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNext}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <select
            value={zoomLevel}
            onChange={(e) => setZoomLevel(e.target.value)}
            className="h-8 border border-gray-300 rounded-md px-2 text-sm"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
          {/* <Button variant="outline" size="icon" className="h-8 w-8"><ZoomIn className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8"><ZoomOut className="w-4 h-4" /></Button>
          <Button variant="outline" size="icon" className="h-8 w-8"><Settings className="w-4 h-4" /></Button> */}
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <div className="min-w-max">
          {" "}
          {/* Ensures horizontal scrolling for timeline content */}
          {/* Timeline Header (Days) */}
          <div className="flex sticky top-[53px] bg-gray-50 z-[5] border-b">
            <div className="w-[200px] flex-shrink-0 p-2 border-r font-medium text-xs text-gray-600">
              Task
            </div>{" "}
            {/* Item Name Column */}
            {daysHeader.map((day) => (
              <div
                key={day.toString()}
                className="flex-shrink-0 text-center p-1 border-r"
                style={{
                  width: `${DAY_CELL_WIDTH * (zoomLevel === "week" ? 1 : zoomLevel === "month" ? 30 / 7 : 1 / 7)}px`,
                }}
              >
                <div className="text-xs text-gray-500">{format(day, "EEE")}</div>
                <div className="text-sm font-medium">{format(day, "d")}</div>
              </div>
            ))}
          </div>
          {/* Timeline Rows (Items) */}
          <div className="relative">
            {" "}
            {/* Container for absolute positioned item bars */}
            {displayItems.map((item, index) => (
              <div
                key={item.id}
                className="flex border-b"
                style={{ height: `${TIMELINE_ITEM_HEIGHT}px` }}
              >
                <div
                  className="w-[200px] flex-shrink-0 p-2 border-r text-xs truncate"
                  title={item.title}
                >
                  {item.title}
                </div>
                <div className="flex-grow relative h-full">
                  {" "}
                  {/* This part will contain the bar */}
                  <TimelineItemBar
                    item={item}
                    board={board}
                    startDate={item.data[startDateColId]}
                    endDate={item.data[endDateColId || startDateColId]}
                    timelineStartDate={timelineStartDate}
                    timelineEndDate={timelineEndDate}
                    zoomLevel={zoomLevel}
                  />
                </div>
              </div>
            ))}
            {displayItems.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                No items with valid start and end dates to display in the timeline.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

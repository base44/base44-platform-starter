import { Board, Item } from "@/lib/entityClient";
import React, { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { subDays, isAfter, isBefore } from "date-fns";
import { getBoardColor } from "@/lib/boardColor";
import { CheckCircle2, PieChart, Flag, LayoutGrid } from "lucide-react";

export default function AnalyticsPage() {
  const [boards, setBoards] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedBoard, setSelectedBoard] = useState("all");
  const [selectedTimeRange, setSelectedTimeRange] = useState("30");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [boardsData, itemsData] = await Promise.all([
        Board.list("-updated_date"),
        Item.list("-updated_date"),
      ]);
      setBoards(boardsData);
      setItems(itemsData);
    } catch (error) {
      console.error("Error loading analytics data:", error);
    }
    setIsLoading(false);
  };

  const filteredItems = items.filter((item) => {
    if (selectedBoard !== "all" && item.board_id !== selectedBoard) return false;
    const daysAgo = parseInt(selectedTimeRange);
    const cutoffDate = subDays(new Date(), daysAgo);
    return isAfter(new Date(item.updated_date), cutoffDate);
  });

  const filteredBoards =
    selectedBoard === "all" ? boards : boards.filter((b) => b.id === selectedBoard);

  const totalTasks = filteredItems.length;
  const completedTasks = filteredItems.filter((item) => {
    const statusColumn = boards
      .find((b) => b.id === item.board_id)
      ?.columns?.find((col) => col.type === "status");
    return item.data?.[statusColumn?.id] === "Done";
  }).length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const overdueTasks = filteredItems.filter((item) => {
    const board = boards.find((b) => b.id === item.board_id);
    const dueDateColumn = board?.columns?.find((col) => col.type === "date");
    const statusColumn = board?.columns?.find((col) => col.type === "status");
    const dueDate = item.data?.[dueDateColumn?.id];
    const status = item.data?.[statusColumn?.id];
    if (!dueDate || status === "Done") return false;
    return isBefore(new Date(dueDate), new Date());
  }).length;

  const boardStats = filteredBoards.map((board) => {
    const boardItems = filteredItems.filter((item) => item.board_id === board.id);
    const statusColumn = board.columns?.find((col) => col.type === "status");
    const completed = boardItems.filter((item) => item.data?.[statusColumn?.id] === "Done").length;
    const total = boardItems.length;
    return {
      ...board,
      totalTasks: total,
      completedTasks: completed,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });

  const statusDistribution = {};
  filteredItems.forEach((item) => {
    const board = boards.find((b) => b.id === item.board_id);
    const statusColumn = board?.columns?.find((col) => col.type === "status");
    const status = item.data?.[statusColumn?.id] || "Not Started";
    statusDistribution[status] = (statusDistribution[status] || 0) + 1;
  });

  const priorityDistribution = {};
  filteredItems.forEach((item) => {
    const board = boards.find((b) => b.id === item.board_id);
    const priorityColumn = board?.columns?.find((col) => col.type === "priority");
    const priority = item.data?.[priorityColumn?.id] || "Medium";
    priorityDistribution[priority] = (priorityDistribution[priority] || 0) + 1;
  });

  const metrics = [
    { label: "Total Tasks", value: totalTasks, note: "Active tasks tracked" },
    { label: "Completed", value: completedTasks, note: `${completionRate}% completion rate` },
    { label: "Overdue", value: overdueTasks, note: "Need attention", warn: overdueTasks > 0 },
    { label: "Active Boards", value: filteredBoards.length, note: "Boards in view" },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border">
          <div className="px-4 sm:px-6 py-6 md:py-10">
            <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border border border-border rounded-lg overflow-hidden shadow-sm">
            {Array(4)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="bg-card p-5 h-24 animate-pulse" />
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="px-4 sm:px-6 py-6 md:py-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1 hidden">Insights</p>
              <h1 className="font-display text-3xl md:text-4xl text-foreground">Analytics</h1>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedBoard} onValueChange={setSelectedBoard}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue placeholder="All Boards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Boards</SelectItem>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedTimeRange} onValueChange={setSelectedTimeRange}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="365">Last year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {/* Metrics row */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border shadow-sm">
          {metrics.map((m) => (
            <div key={m.label} className="bg-card px-5 py-5">
              <p className="text-[13px] font-medium text-muted-foreground mb-2">{m.label}</p>
              <p
                className={`text-3xl font-semibold leading-none mb-1 ${m.warn ? "text-destructive" : "text-foreground"}`}
              >
                {m.value}
              </p>
              <p className="text-xs text-muted-foreground">{m.note}</p>
            </div>
          ))}
        </div>

        {/* Completion rate bar */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
            Overall completion
          </h2>
          <div className="bg-card border border-border rounded-lg shadow-sm p-5 md:p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Completion rate</span>
              <span className="text-sm text-muted-foreground">{completionRate}%</span>
            </div>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        </div>

        {/* Two-column distributions */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Status */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <PieChart className="w-4 h-4 text-muted-foreground" />
              Status distribution
            </h2>
            <div className="bg-card border border-border rounded-lg shadow-sm p-5 md:p-6">
              {Object.keys(statusDistribution).length === 0 ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(statusDistribution).map(([status, count]) => {
                    const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                    return (
                      <div key={status}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-foreground">{status}</span>
                          <span className="text-xs text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/70 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Priority */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Flag className="w-4 h-4 text-muted-foreground" />
              Priority distribution
            </h2>
            <div className="bg-card border border-border rounded-lg shadow-sm p-5 md:p-6">
              {Object.keys(priorityDistribution).length === 0 ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <div className="space-y-3">
                  {Object.entries(priorityDistribution).map(([priority, count]) => {
                    const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                    const color = getPriorityAccent(priority);
                    return (
                      <div key={priority}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-foreground flex items-center gap-2">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            {priority}
                          </span>
                          <span className="text-xs text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Board performance */}
        {selectedBoard === "all" && boardStats.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-muted-foreground" />
              Board performance
            </h2>
            <div className="space-y-px bg-border border border-border rounded-lg overflow-hidden shadow-sm">
              {boardStats.map((board) => (
                <div key={board.id} className="bg-card px-5 py-4 flex items-center gap-4">
                  <div
                    className="w-0.5 h-8 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getBoardColor(board) }}
                  />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{board.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {board.completedTasks} of {board.totalTasks} tasks done
                    </p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="w-28 h-1 bg-border rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${board.completionRate}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground w-10 text-right">
                      {board.completionRate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getPriorityAccent(priority) {
  switch (priority.toLowerCase()) {
    case "critical":
      return "#F06A6A";
    case "high":
      return "#EC8D71";
    case "medium":
      return "#F1BD6C";
    case "low":
      return "#5DA283";
    default:
      return "#6D6E6F";
  }
}

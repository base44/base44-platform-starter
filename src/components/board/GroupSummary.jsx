import React from "react";
import { Badge } from "@/components/ui/badge";

export default function GroupSummary({ items, columns }) {
  // Calculate summary stats
  const statusColumn = columns.find((col) => col.type === "status");
  const numberColumns = columns.filter((col) => col.type === "number");

  const statusCounts = {};
  let totalBudget = 0;

  items.forEach((item) => {
    // Count statuses
    const status = item.data?.status || "Not Started";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    // Sum numbers (assuming budget column)
    numberColumns.forEach((col) => {
      const value = item.data?.[col.id];
      if (typeof value === "number") {
        totalBudget += value;
      }
    });
  });

  const completedCount = statusCounts["Done"] || statusCounts["done"] || 0;
  const totalCount = items.length;

  if (totalCount === 0) return null;

  return (
    <div className="flex items-center gap-4">
      {/* Status Summary */}
      <div className="flex items-center gap-2">
        {Object.entries(statusCounts).map(([status, count]) => {
          const color = getStatusColor(status);
          return (
            <div key={status} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-[#6D6E6F]">{count}</span>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-[#EDEDED] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5DA283] transition-all duration-300"
            style={{ width: `${(completedCount / totalCount) * 100}%` }}
          />
        </div>
        <span className="text-xs text-[#6D6E6F]">
          {Math.round((completedCount / totalCount) * 100)}%
        </span>
      </div>

      {/* Total Budget */}
      {totalBudget > 0 && (
        <Badge variant="outline" className="text-xs border-[#EDEDED]">
          ${totalBudget.toLocaleString()}
        </Badge>
      )}
    </div>
  );
}

function getStatusColor(status) {
  switch (status.toLowerCase()) {
    case "done":
    case "completed":
      return "#5DA283";
    case "working on it":
    case "working":
    case "in progress":
      return "#F1BD6C";
    case "stuck":
      return "#F06A6A";
    default:
      return "#C4C4C4";
  }
}

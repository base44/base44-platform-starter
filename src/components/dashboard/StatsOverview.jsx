import React from "react";
import { LayoutGrid, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function StatsOverview({ boards, items, isLoading }) {
  const completedItems = items.filter((item) => item.data?.status === "done").length;
  const pendingItems = items.filter(
    (item) => !item.data?.status || item.data?.status !== "done",
  ).length;
  const completionRate = items.length > 0 ? Math.round((completedItems / items.length) * 100) : 0;

  const stats = [
    { label: "Total Boards", value: boards.length, icon: LayoutGrid, color: "#0E2E56" },
    { label: "Completed Tasks", value: completedItems, icon: CheckCircle2, color: "#5DA283" },
    { label: "Pending Tasks", value: pendingItems, icon: Clock, color: "#EC8D71" },
    { label: "Completion Rate", value: `${completionRate}%`, icon: TrendingUp, color: "#9747FF" },
  ];

  return null;
}

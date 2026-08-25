import React, { useState } from "react";
import { Plus, Sparkles, Calendar, BarChart3, Zap } from "lucide-react";
import Link from "next/link";
import { createPageUrl } from "@/utils";

import CreateBoardModal from "../boards/CreateBoardModal";
import CalendarModal from "./CalendarModal";

export default function QuickActions({ onCreateBoard, team }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const handleCreateBoard = async (boardData) => {
    if (onCreateBoard) await onCreateBoard(boardData);
    setShowCreateModal(false);
  };

  const openAssistantBuild = () =>
    window.dispatchEvent(new CustomEvent("open-assistant", { detail: { mode: "build" } }));

  const secondary = [
    { label: "Build a tool", icon: Sparkles, color: "#0E2E56", onClick: openAssistantBuild },
    {
      label: "Calendar",
      icon: Calendar,
      color: "#9747FF",
      onClick: () => setShowCalendarModal(true),
    },
    { label: "Analytics", icon: BarChart3, color: "#EC8D71", link: createPageUrl("Analytics") },
  ];

  return (
    <>
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-3 h-6">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Quick actions
          </h3>
        </div>

        <div className="bg-card border border-border rounded-lg shadow-sm p-4">
          {/* Primary action — full-width, signature gradient */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full text-left rounded-lg p-4 mb-2 text-white shadow-sm hover:shadow-md transition-all flex items-center gap-3"
            style={{ background: "linear-gradient(135deg,#0E2E56 0%,#2E5A93 100%)" }}
          >
            <span className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">New board</span>
              <span className="block text-xs text-white/80">Start organizing a new project</span>
            </span>
          </button>

          {/* Secondary actions — compact row */}
          <div className="grid grid-cols-3 gap-2">
            {secondary.map((action) => {
              const inner = (
                <div className="flex flex-col items-center text-center gap-2 p-3 rounded-lg border border-border bg-background hover:border-primary/40 hover:shadow-md transition-all cursor-pointer h-full">
                  <span
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${action.color}1A`, color: action.color }}
                  >
                    <action.icon className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-medium text-foreground">{action.label}</span>
                </div>
              );
              return action.link ? (
                <Link key={action.label} href={action.link}>
                  {inner}
                </Link>
              ) : (
                <div key={action.label} onClick={action.onClick}>
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <CreateBoardModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateBoard}
      />
      <CalendarModal isOpen={showCalendarModal} onClose={() => setShowCalendarModal(false)} />
    </>
  );
}

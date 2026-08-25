import React, { useState, useEffect } from "react";
import { Board, Item, Team, Widget, me } from "@/lib/entityClient";
import Link from "next/link";
import { createPageUrl } from "@/utils";
import { ArrowRight, Plus, Users } from "lucide-react";

import StatsOverview from "../components/dashboard/StatsOverview";
import RecentBoards from "../components/dashboard/RecentBoards";
import QuickActions from "../components/dashboard/QuickActions";
import DashboardWidgets from "../components/dashboard/DashboardWidgets";
import AddWidgetModal from "../components/dashboard/AddWidgetModal";
import TeamBanner from "../components/team/TeamBanner";
import TeamSetupModal from "../components/team/TeamSetupModal";

export default function Dashboard() {
  const [boards, setBoards] = useState([]);
  const [items, setItems] = useState([]);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [widgets, setWidgets] = useState([]);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [team, setTeam] = useState(null);
  const [showTeamModal, setShowTeamModal] = useState(false);

  const refetchWidgets = async () => {
    const widgetsData = await Widget.list("order_index", 20);
    setWidgets(widgetsData);
  };

  useEffect(() => {
    loadDashboardData();
    const handler = () => refetchWidgets();
    window.addEventListener("widgets-updated", handler);
    return () => window.removeEventListener("widgets-updated", handler);
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [boardsData, itemsData, userData, widgetsData, teamsData] = await Promise.all([
        Board.list("-updated_date", 10),
        Item.list("-updated_date", 20),
        me(),
        Widget.list("order_index", 20),
        Team.list("-created_date", 1),
      ]);
      setBoards(boardsData);
      setItems(itemsData);
      setUser(userData);
      setWidgets(widgetsData);
      setTeam(teamsData[0] || null);
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    }
    setIsLoading(false);
  };

  const handleWidgetAdded = (widget) => {
    setWidgets((prev) => [...prev, widget]);
  };

  const handleWidgetRemove = async (widgetId) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    await Widget.delete(widgetId);
  };

  const handleCreateBoard = async (boardData) => {
    try {
      const newBoard = await Board.create(boardData);
      setBoards((prev) => [newBoard, ...prev]);
    } catch (error) {
      console.error("Error creating board:", error);
    }
  };

  const pendingTasks = items.filter(
    (item) => !item.data?.status || item.data?.status !== "done",
  ).length;
  const firstName = user?.full_name?.split(" ")[0] || null;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header strip */}
      <div className="border-b border-border">
        <div className="px-4 sm:px-6 py-5 md:py-7">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{today}</p>
              <h1 className="text-2xl text-foreground font-semibold tracking-tight">
                {firstName ? `${greeting}, ${firstName}` : "Your workspace"}
              </h1>
              {pendingTasks > 0 && (
                <p className="text-muted-foreground mt-1 text-sm">
                  You have {pendingTasks} task{pendingTasks !== 1 ? "s" : ""} pending across your
                  boards.
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!team && (
                <button
                  onClick={() => setShowTeamModal(true)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground border border-border px-4 py-2 rounded hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Users className="w-3.5 h-3.5" /> Create team
                </button>
              )}
              <Link
                href={createPageUrl("Boards")}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded hover:bg-primary/90 transition-colors"
              >
                All Boards <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {/* Team banner */}
        {team && <TeamBanner team={team} onEdit={() => setShowTeamModal(true)} />}

        {/* Stats row */}
        <StatsOverview boards={boards} items={items} isLoading={isLoading} />

        {/* Main content — asymmetric grid */}
        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2">
            <RecentBoards
              boards={boards}
              items={items}
              isLoading={isLoading}
              onCreateBoard={handleCreateBoard}
            />
          </div>
          <div className="space-y-6">
            <QuickActions onCreateBoard={handleCreateBoard} team={team} />
          </div>
        </div>

        {/* Widgets — full width */}
        <DashboardWidgets
          widgets={widgets}
          onRemove={handleWidgetRemove}
          onAddClick={() => setShowAddWidget(true)}
        />
      </div>

      <TeamSetupModal
        open={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        existingTeam={team}
        onSaved={(t) => setTeam(t)}
      />

      <AddWidgetModal
        open={showAddWidget}
        onClose={() => setShowAddWidget(false)}
        existingAppIds={widgets.map((w) => w.app_id)}
        onAdded={handleWidgetAdded}
        onBuildNew={() => {
          window.dispatchEvent(new CustomEvent("open-assistant", { detail: { mode: "build" } }));
        }}
      />
    </div>
  );
}

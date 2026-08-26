import React, { useState, useEffect, useMemo } from "react";
import { Board, Item, Team, Widget, me } from "@/lib/entityClient";
import { Plus, Users } from "lucide-react";

import RecentBoards from "../components/dashboard/RecentBoards";
import TaskStats from "../components/dashboard/TaskStats";
import WorkList from "../components/dashboard/WorkList";
import CreateBoardModal from "../components/boards/CreateBoardModal";
import DashboardWidgets from "../components/dashboard/DashboardWidgets";
import AddWidgetModal from "../components/dashboard/AddWidgetModal";
import MarketCard from "../components/dashboard/MarketCard";
import TeamBanner from "../components/team/TeamBanner";
import TeamSetupModal from "../components/team/TeamSetupModal";
import { useToast } from "@/components/ui/toast";
import { summarize } from "@/lib/taskStats";

/**
 * Boards and items are fetched whole, not paged, because everything on this page
 * is a *count*: a capped fetch silently under-reports rather than showing "more".
 * The entity API caps at MAX_LIMIT, and a workspace past that has outgrown a
 * client-side dashboard anyway.
 */
const COUNT_LIMIT = 1000;

export default function Dashboard() {
  const [boards, setBoards] = useState([]);
  const [items, setItems] = useState([]);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [widgets, setWidgets] = useState([]);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [team, setTeam] = useState(null);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [filter, setFilter] = useState(null);
  const [highlightWidgetId, setHighlightWidgetId] = useState(null);
  const { toast } = useToast();

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
        Board.list("-updated_date", COUNT_LIMIT),
        Item.list("-updated_date", COUNT_LIMIT),
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
    setHighlightWidgetId(widget.id);
    toast({ message: `Added “${widget.app_name}” to My Widgets.` });
  };

  const handleWidgetRemove = async (widgetId) => {
    const removed = widgets.find((w) => w.id === widgetId);
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    await Widget.delete(widgetId);
    if (!removed) return;

    toast({
      message: `Removed “${removed.app_name}”.`,
      actionLabel: "Undo",
      // A widget row is only a pin, so putting it back is a re-create. The id
      // changes; nothing the user can see does.
      action: async () => {
        const { id: _id, created_date, updated_date, created_by, ...pin } = removed;
        try {
          const restored = await Widget.create(pin);
          setWidgets((prev) => [...prev, restored]);
          setHighlightWidgetId(restored.id);
        } catch (error) {
          console.error("Error restoring widget:", error);
          toast({ message: "Couldn't put that widget back." });
        }
      },
    });
  };

  const handleCreateBoard = async (boardData) => {
    try {
      const newBoard = await Board.create(boardData);
      setBoards((prev) => [newBoard, ...prev]);
      setShowCreateBoard(false);
      toast({ message: `Created “${newBoard.title}”.` });
    } catch (error) {
      console.error("Error creating board:", error);
    }
  };

  /** Writes one status cell, addressed by the board's own status column id. */
  const handleStatusChange = async (item, columnId, label) => {
    const nextData = { ...(item.data || {}), [columnId]: label };
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? { ...it, data: nextData, updated_date: new Date().toISOString() }
          : it,
      ),
    );
    try {
      await Item.update(item.id, { data: nextData });
    } catch (error) {
      console.error("Error updating item:", error);
      setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
      toast({ message: "Couldn't save that status." });
    }
  };

  const boardsById = useMemo(() => {
    const map = new Map();
    for (const board of boards) map.set(board.id, board);
    return map;
  }, [boards]);

  const stats = useMemo(() => summarize(boards, items), [boards, items]);
  const listItems = filter ? stats.buckets[filter] : stats.scoped;

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
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-5 md:py-7">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">{today}</p>
              <h1 className="text-2xl text-foreground font-semibold tracking-tight">
                {firstName ? `${greeting}, ${firstName}` : "Your workspace"}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {!team && (
                <button
                  onClick={() => setShowTeamModal(true)}
                  className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground border border-border px-4 py-2 min-h-[40px] rounded hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  <Users className="w-3.5 h-3.5" aria-hidden="true" /> Create team
                </button>
              )}
              {/* The page's one primary control is an action, not a second route
                  to a page already in the nav. */}
              <button
                onClick={() => setShowCreateBoard(true)}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 min-h-[40px] rounded hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New board
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {team && <TeamBanner team={team} onEdit={() => setShowTeamModal(true)} />}

        <TaskStats
          buckets={stats.buckets}
          selected={filter}
          onSelect={setFilter}
          isLoading={isLoading}
        />

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2">
            <WorkList
              items={listItems}
              boardsById={boardsById}
              isLoading={isLoading}
              filter={filter}
              onStatusChange={handleStatusChange}
            />
          </div>
          <div className="space-y-6">
            <RecentBoards
              boards={boards}
              items={stats.scoped}
              isLoading={isLoading}
              onCreateBoard={handleCreateBoard}
            />
            <MarketCard />
          </div>
        </div>

        <DashboardWidgets
          widgets={widgets}
          onRemove={handleWidgetRemove}
          onAddClick={() => setShowAddWidget(true)}
          highlightId={highlightWidgetId}
          onHighlightDone={() => setHighlightWidgetId(null)}
        />
      </div>

      <TeamSetupModal
        open={showTeamModal}
        onClose={() => setShowTeamModal(false)}
        existingTeam={team}
        onSaved={(t) => setTeam(t)}
      />

      <CreateBoardModal
        isOpen={showCreateBoard}
        onClose={() => setShowCreateBoard(false)}
        onSubmit={handleCreateBoard}
      />

      <AddWidgetModal
        open={showAddWidget}
        onClose={() => setShowAddWidget(false)}
        existingAppIds={widgets.map((w) => w.app_id)}
        onAdded={handleWidgetAdded}
        onBuildNew={() => {
          window.dispatchEvent(
            new CustomEvent("open-assistant", {
              detail: { mode: "build", origin: "home-widget" },
            }),
          );
        }}
      />
    </div>
  );
}

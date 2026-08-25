import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Users, Calendar, Target, Clock } from "lucide-react";
import { format } from "date-fns";

export default function AnalyticsPanel({ board, items, onClose }) {
  // Calculate analytics data
  const statusColumn = board?.columns?.find((col) => col.type === "status");
  const priorityColumn = board?.columns?.find((col) => col.type === "priority");
  const peopleColumn = board?.columns?.find((col) => col.type === "people");
  const dueDateColumn = board?.columns?.find((col) => col.type === "date");

  // Status distribution
  const statusStats = {};
  if (statusColumn?.options?.choices) {
    statusColumn.options.choices.forEach((choice) => {
      statusStats[choice.label] = items.filter(
        (item) => item.data?.[statusColumn.id] === choice.label,
      ).length;
    });
  }

  // Priority distribution
  const priorityStats = {};
  if (priorityColumn?.options?.choices) {
    priorityColumn.options.choices.forEach((choice) => {
      priorityStats[choice.label] = items.filter(
        (item) => item.data?.[priorityColumn.id] === choice.value,
      ).length;
    });
  }

  // People workload
  const peopleStats = {};
  if (peopleColumn) {
    items.forEach((item) => {
      const person = item.data?.[peopleColumn.id];
      if (person) {
        peopleStats[person] = (peopleStats[person] || 0) + 1;
      }
    });
  }

  // Overdue tasks
  const overdueTasks = items.filter((item) => {
    const dueDate = item.data?.[dueDateColumn?.id];
    if (!dueDate) return false;
    return new Date(dueDate) < new Date() && item.data?.[statusColumn?.id] !== "Done";
  });

  // Completion rate
  const completedTasks = items.filter((item) => item.data?.[statusColumn?.id] === "Done").length;
  const completionRate = items.length > 0 ? Math.round((completedTasks / items.length) * 100) : 0;

  // Recent activity (mock data based on updated_date)
  const recentActivity = items
    .sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date))
    .slice(0, 5);

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Board Analytics</h2>
            <p className="text-gray-600">Insights and statistics for {board?.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full"
          >
            ×
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Overview Cards */}
          <Card className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="w-5 h-5" />
                Total Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{items.length}</div>
              <p className="text-blue-100">Active items in board</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-green-500 to-green-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Completion Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{completionRate}%</div>
              <Progress value={completionRate} className="mt-2 bg-green-300" />
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-red-500 to-red-600 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Overdue Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{overdueTasks.length}</div>
              <p className="text-red-100">Need immediate attention</p>
            </CardContent>
          </Card>

          {/* Status Distribution */}
          {Object.keys(statusStats).length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Status Distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(statusStats).map(([status, count]) => {
                    const statusChoice = statusColumn?.options?.choices?.find(
                      (c) => c.label === status,
                    );
                    const percentage =
                      items.length > 0 ? Math.round((count / items.length) * 100) : 0;
                    return (
                      <div key={status} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: statusChoice?.color || "#gray" }}
                          />
                          <span className="font-medium">{status}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-600">{count} tasks</span>
                          <Badge variant="outline">{percentage}%</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* People Workload */}
          {Object.keys(peopleStats).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Team Workload
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(peopleStats)
                    .slice(0, 5)
                    .map(([person, count]) => (
                      <div key={person} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                            {person.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium">{person}</span>
                        </div>
                        <Badge>{count} tasks</Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Priority Breakdown */}
          {Object.keys(priorityStats).length > 0 && (
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Priority Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(priorityStats).map(([priority, count]) => {
                    const priorityChoice = priorityColumn?.options?.choices?.find(
                      (c) => c.label === priority,
                    );
                    return (
                      <div key={priority} className="text-center p-4 bg-gray-50 rounded-lg">
                        <div
                          className="w-4 h-4 rounded-full mx-auto mb-2"
                          style={{ backgroundColor: priorityChoice?.color || "#gray" }}
                        />
                        <div className="text-2xl font-bold">{count}</div>
                        <div className="text-sm text-gray-600">{priority}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Activity */}
          {recentActivity.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentActivity.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1 p-2 bg-gray-50 rounded">
                      <div className="font-medium text-sm truncate">{item.title}</div>
                      <div className="text-xs text-gray-500">
                        Updated {format(new Date(item.updated_date), "MMM d, HH:mm")}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {items.length === 0 && (
            <Card className="md:col-span-3 text-center p-8">
              <div className="text-gray-500">
                <BarChart3 className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Data Available</h3>
                <p>Add some tasks to your board to see analytics</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

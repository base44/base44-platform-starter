import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Zap, Plus, Bell, CheckCircle, AlertTriangle, Clock, Users, Settings } from "lucide-react";

const automationTemplates = [
  {
    id: "status-change-notify",
    name: "Notify on Status Change",
    icon: Bell,
    description: 'When a task status changes to "Done", notify the project manager.',
    category: "Notifications",
    color: "bg-blue-500",
  },
  {
    id: "due-date-reminder",
    name: "Due Date Reminder",
    icon: Clock,
    description: "24 hours before a task is due, send a reminder to the assignee.",
    category: "Reminders",
    color: "bg-yellow-500",
  },
  {
    id: "item-created-assign",
    name: "Assign New Item",
    icon: Users,
    description: "When a new item is created, assign it to the team lead.",
    category: "Assignments",
    color: "bg-green-500",
  },
  {
    id: "priority-escalation",
    name: "Priority Escalation",
    icon: AlertTriangle,
    description: 'If a "High Priority" task is overdue by 2 days, change its status to "Critical".',
    category: "Workflow",
    color: "bg-red-500",
  },
  {
    id: "subitem-completion",
    name: "Subitem Completion Update",
    icon: CheckCircle,
    description: 'When all subitems of a task are "Done", update parent task status to "Review".',
    category: "Workflow",
    color: "bg-purple-500",
  },
];

const AutomationRecipeCard = ({ recipe, isActive, onToggle }) => {
  return (
    <Card className="hover:shadow-lg transition-shadow duration-200 border-[#EDEDED]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center ${recipe.color}`}
            >
              <recipe.icon className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-[#1E1F21]">{recipe.name}</CardTitle>
              <Badge variant="outline" className="text-xs mt-1">
                {recipe.category}
              </Badge>
            </div>
          </div>
          <Switch
            checked={isActive}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-green-500 data-[state=unchecked]:bg-gray-200"
          />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-[#6D6E6F] mb-3">{recipe.description}</p>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-[#0E2E56] hover:bg-[#0E2E56]/10">
            <Settings className="w-3 h-3 mr-1" />
            Customize
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default function AutomationsPanel({ board, onClose }) {
  const [activeAutomations, setActiveAutomations] = useState({});

  const toggleAutomation = (automationId) => {
    setActiveAutomations((prev) => ({
      ...prev,
      [automationId]: !prev[automationId],
    }));
    // In a real app, this would save the automation state for the board
    console.log(`Toggled automation ${automationId} for board ${board?.id}`);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Automations Center</h2>
            <p className="text-gray-600">Automate repetitive tasks for {board?.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-full"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg flex items-center gap-3">
            <Zap className="w-6 h-6 text-purple-600" />
            <div>
              <h3 className="font-semibold text-purple-800">Work Smarter, Not Harder</h3>
              <p className="text-sm text-purple-700">
                Set up automated rules to save time and keep your board updated effortlessly.
              </p>
            </div>
          </div>

          <div className="mb-6">
            <Button className="bg-[#0E2E56] hover:bg-[#163C6B] text-white">
              <Plus className="w-4 h-4 mr-2" />
              Create Custom Automation
            </Button>
          </div>

          <h3 className="text-lg font-semibold text-gray-700 mb-4">Popular Automation Recipes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {automationTemplates.map((recipe) => (
              <AutomationRecipeCard
                key={recipe.id}
                recipe={recipe}
                isActive={!!activeAutomations[recipe.id]}
                onToggle={() => toggleAutomation(recipe.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

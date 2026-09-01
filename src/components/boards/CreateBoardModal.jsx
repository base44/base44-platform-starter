import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, Globe } from "lucide-react";
import { soften } from "@/lib/boardColor";

const colorOptions = [
  { name: "Blue", value: "#5B87DA" },
  { name: "Green", value: "#57B394" },
  { name: "Amber", value: "#E6B45C" },
  { name: "Coral", value: "#E88585" },
  { name: "Violet", value: "#A783DE" },
  { name: "Teal", value: "#4FC3BC" },
];

export default function CreateBoardModal({ isOpen, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    color: "#5B87DA",
    visibility: "private",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    setIsSubmitting(true);
    try {
      const boardData = {
        ...formData,
        columns: [
          {
            id: "task", // Always keep task column first
            title: "Task",
            type: "text",
            width: 250, // Increased default width for task
          },
          {
            id: "priority", // New default column
            title: "Priority",
            type: "dropdown", // Assuming priority is a dropdown
            width: 120,
            options: {
              choices: [
                { value: "low", label: "Low", color: "#5DA283" },
                { value: "medium", label: "Medium", color: "#F1BD6C" },
                { value: "high", label: "High", color: "#EC8D71" },
                { value: "critical", label: "Critical", color: "#F06A6A" },
              ],
            },
          },
          {
            id: "status",
            title: "Status",
            type: "status",
            width: 150,
            options: {
              choices: [
                { label: "Not Started", color: "#C4C4C4" },
                { label: "Working on it", color: "#F1BD6C" },
                { label: "Done", color: "#5DA283" },
                { label: "Stuck", color: "#F06A6A" },
              ],
            },
          },
          {
            id: "owner",
            title: "Owner",
            type: "people",
            width: 150,
          },
          {
            id: "due_date",
            title: "Due Date",
            type: "date",
            width: 150,
          },
        ],
        groups: [
          {
            id: "group1", // Keep a default group
            title: "New Group",
            color: formData.color, // Use selected board color for the group
            collapsed: false,
          },
        ],
      };

      await onSubmit(boardData);
      setFormData({ title: "", description: "", color: "#5B87DA", visibility: "private" });
    } catch (error) {
      console.error("Error creating board:", error);
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#1E1F21]">Create New Board</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title" className="text-[#1E1F21] font-medium">
              Board Title *
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Enter board title..."
              className="rounded-lg border-[#EDEDED] h-10 focus:ring-2 focus:ring-[#0E2E56]/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-[#1E1F21] font-medium">
              Description
            </Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="What's this board about?"
              className="rounded-lg border-[#EDEDED] min-h-20 focus:ring-2 focus:ring-[#0E2E56]/20"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[#1E1F21] font-medium">Board Color</Label>
            <div className="flex gap-2 flex-wrap">
              {colorOptions.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, color: color.value }))}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    formData.color === color.value
                      ? "border-[#1E1F21] scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: soften(color.value) }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[#1E1F21] font-medium">Visibility</Label>
            <Select
              value={formData.visibility}
              onValueChange={(value) => setFormData((prev) => ({ ...prev, visibility: value }))}
            >
              <SelectTrigger className="rounded-lg border-[#EDEDED] h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    <span>Private — only you</span>
                  </div>
                </SelectItem>
                {/* Not a label any more: this is the flag readWhere() reads, so
                    picking it grants the whole workspace a read. */}
                <SelectItem value="shared">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    <span>Shared — anyone signed in can view</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-lg h-10 px-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!formData.title.trim() || isSubmitting}
              className="bg-[#0E2E56] hover:bg-[#163C6B] text-white rounded-lg h-10 px-6 font-medium"
            >
              {isSubmitting ? "Creating..." : "Create Board"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

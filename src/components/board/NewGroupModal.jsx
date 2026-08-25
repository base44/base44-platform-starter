import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { soften } from "@/lib/boardColor";

const colorOptions = [
  { name: "Blue", value: "#5B87DA" },
  { name: "Green", value: "#57B394" },
  { name: "Amber", value: "#E6B45C" },
  { name: "Coral", value: "#E88585" },
  { name: "Violet", value: "#A783DE" },
  { name: "Teal", value: "#4FC3BC" },
  { name: "Slate", value: "#8B93A6" },
];

export default function NewGroupModal({ isOpen, onClose, onSubmit }) {
  const [groupData, setGroupData] = useState({
    title: "",
    color: "#5B87DA", // Default color
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!groupData.title.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(groupData);
      setGroupData({ title: "", color: "#5B87DA" }); // Reset form
    } catch (error) {
      console.error("Error creating group:", error);
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#1E1F21]">Add New Group</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-4">
          <div className="space-y-2">
            <Label htmlFor="group-title" className="text-[#1E1F21] font-medium">
              Group Title *
            </Label>
            <Input
              id="group-title"
              value={groupData.title}
              onChange={(e) => setGroupData((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="e.g., To Do, In Progress"
              className="rounded-lg border-[#EDEDED] h-10 focus:ring-2 focus:ring-[#0E2E56]/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[#1E1F21] font-medium">Group Color</Label>
            <div className="flex gap-2 flex-wrap">
              {colorOptions.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setGroupData((prev) => ({ ...prev, color: color.value }))}
                  className={`w-8 h-8 rounded-lg border-2 transition-all ${
                    groupData.color === color.value
                      ? "border-[#1E1F21] scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: soften(color.value) }}
                  title={color.name}
                />
              ))}
            </div>
          </div>
          <DialogFooter className="pt-6">
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
              disabled={!groupData.title.trim() || isSubmitting}
              className="bg-[#0E2E56] hover:bg-[#163C6B] text-white rounded-lg h-10 px-6 font-medium"
            >
              {isSubmitting ? "Adding..." : "Add Group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

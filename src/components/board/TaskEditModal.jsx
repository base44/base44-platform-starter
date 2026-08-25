import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";

export default function TaskEditModal({ isOpen, onClose, task, board, onUpdate, onDelete }) {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (task && board) {
      // Initialize form data with current task values
      const initialData = {
        title: task.title,
        description: task.description || "",
        ...task.data,
      };
      setFormData(initialData);
    }
  }, [task, board]);

  if (!task || !board) return null;

  const handleSave = () => {
    const { title, description, ...data } = formData;
    onUpdate(task.id, {
      title,
      description,
      data,
    });
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      onDelete(task.id);
      onClose();
    }
  };

  const renderField = (column) => {
    const value = formData[column.id];

    switch (column.type) {
      case "text":
        return (
          <Input
            value={value || ""}
            onChange={(e) => setFormData({ ...formData, [column.id]: e.target.value })}
            placeholder={`Enter ${column.title.toLowerCase()}...`}
          />
        );

      case "status":
        return (
          <Select
            value={value || ""}
            onValueChange={(newValue) => setFormData({ ...formData, [column.id]: newValue })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {column.options?.choices?.map((choice) => (
                <SelectItem key={choice.label} value={choice.label}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: choice.color }}
                    />
                    <span>{choice.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "priority":
        return (
          <Select
            value={value || ""}
            onValueChange={(newValue) => setFormData({ ...formData, [column.id]: newValue })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select priority" />
            </SelectTrigger>
            <SelectContent>
              {column.options?.choices?.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: choice.color }}
                    />
                    <span>{choice.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case "people":
        return (
          <Input
            value={value || ""}
            onChange={(e) => setFormData({ ...formData, [column.id]: e.target.value })}
            placeholder="Enter person name..."
          />
        );

      case "date":
        return (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {value ? format(new Date(value), "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0">
              <Calendar
                mode="single"
                selected={value ? new Date(value) : undefined}
                onSelect={(date) => setFormData({ ...formData, [column.id]: date })}
                autoFocus
              />
            </PopoverContent>
          </Popover>
        );

      case "number":
        return (
          <Input
            type="number"
            value={value || ""}
            onChange={(e) =>
              setFormData({ ...formData, [column.id]: parseFloat(e.target.value) || 0 })
            }
            placeholder="Enter number..."
          />
        );

      default:
        return (
          <Input
            value={value || ""}
            onChange={(e) => setFormData({ ...formData, [column.id]: e.target.value })}
            placeholder={`Enter ${column.title.toLowerCase()}...`}
          />
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-[#1E1F21] flex items-center justify-between">
            Edit Task
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Task Title */}
          <div className="space-y-2">
            <Label className="text-[#1E1F21] font-medium text-base">Task Title</Label>
            <Input
              value={formData.title || ""}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter task title..."
              className="text-lg font-medium"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label className="text-[#1E1F21] font-medium text-base">Description</Label>
            <Textarea
              value={formData.description || ""}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Add a description..."
              rows={4}
            />
          </div>

          {/* Dynamic Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {board.columns
              ?.filter((col) => col.id !== "task")
              .map((column) => (
                <div key={column.id} className="space-y-2">
                  <Label className="text-[#1E1F21] font-medium">{column.title}</Label>
                  {renderField(column)}
                </div>
              ))}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete Task
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-[#0E2E56] hover:bg-[#163C6B]">
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

const DEFAULT_COLORS = [
  "#0E2E56",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#F59E0B",
  "#EF4444",
  "#10B981",
  "#6366F1",
  "#F97316",
];

export default function ColumnChoicesModal({ column, open, onClose, onSave }) {
  const [choices, setChoices] = useState(column.options?.choices || []);
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    if (open) {
      setChoices(column.options?.choices || []);
      setNewLabel("");
    }
  }, [open, column]);

  const addChoice = () => {
    const label = newLabel.trim();
    if (!label) return;
    const color = DEFAULT_COLORS[choices.length % DEFAULT_COLORS.length];
    setChoices((prev) => [...prev, { value: label, label, color }]);
    setNewLabel("");
  };

  const removeChoice = (idx) => {
    setChoices((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    onSave({ options: { ...column.options, choices } });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configure "{column.title}" choices</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {choices.map((choice, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: choice.color || "#9AA3B0" }}
              />
              <span className="flex-1 text-sm">{choice.label}</span>
              <button
                onClick={() => removeChoice(idx)}
                className="text-muted-foreground hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {choices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-3">No choices yet</p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addChoice();
            }}
            placeholder="Add a choice…"
            className="h-8 text-sm"
          />
          <Button size="sm" onClick={addChoice} className="h-8 px-3">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

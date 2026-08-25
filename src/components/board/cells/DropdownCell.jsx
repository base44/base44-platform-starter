import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TEAM_COLORS = {
  product: "#0E2E56",
  engineering: "#3B82F6",
  data: "#8B5CF6",
  marketing: "#EC4899",
  growth: "#14B8A6",
};

function getDotColor(choice) {
  if (choice.color) return choice.color;
  return (
    TEAM_COLORS[(choice.value || "").toLowerCase()] ||
    TEAM_COLORS[(choice.label || "").toLowerCase()] ||
    "#9AA3B0"
  );
}

export default function DropdownCell({ value, onUpdate, options }) {
  const choices = options?.choices || [];
  const selectedChoice = choices.find((c) => c.value === value);
  const dotColor = selectedChoice ? getDotColor(selectedChoice) : null;

  return (
    <Select value={value || ""} onValueChange={onUpdate}>
      <SelectTrigger className="h-full w-full border-none bg-transparent px-3 py-0 focus:ring-0 shadow-none text-sm text-[#1E1F21] gap-2">
        {selectedChoice ? (
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: dotColor }}
            />
            <span className="truncate">{selectedChoice.label}</span>
          </span>
        ) : (
          <SelectValue placeholder="Select…" />
        )}
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => {
          const color = getDotColor(choice);
          return (
            <SelectItem key={choice.value} value={choice.value}>
              <div className="flex items-center gap-2">
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span>{choice.label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

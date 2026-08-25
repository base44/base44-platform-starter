import React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PRIORITY_STYLES = {
  critical: { bg: "#FCE4E4", text: "#B42318", label: "Critical" },
  high: { bg: "#FDE7D6", text: "#C2410C", label: "High" },
  medium: { bg: "#FEF3D6", text: "#B45309", label: "Medium" },
  low: { bg: "#DFF3E6", text: "#17734A", label: "Low" },
};

export default function PriorityCell({ value, onUpdate, options }) {
  const choices = options?.choices || [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "critical", label: "Critical" },
  ];

  const style = PRIORITY_STYLES[value] || null;

  return (
    <Select value={value || ""} onValueChange={onUpdate}>
      <SelectTrigger className="h-full w-full border-none bg-transparent p-0 focus:ring-0 shadow-none text-sm">
        {style ? (
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
            style={{ backgroundColor: style.bg, color: style.text }}
          >
            {style.label}
          </span>
        ) : (
          <SelectValue placeholder="Set priority…" />
        )}
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => {
          const s = PRIORITY_STYLES[choice.value];
          return (
            <SelectItem key={choice.value} value={choice.value}>
              {s ? (
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: s.bg, color: s.text }}
                >
                  {s.label}
                </span>
              ) : (
                <span>{choice.label}</span>
              )}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

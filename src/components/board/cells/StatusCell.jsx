import React, { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_STYLES = {
  "in progress": { bg: "#E1EBFA", text: "#1E4C8A" },
  blocked: { bg: "#FCE4E4", text: "#B42318" },
  "in review": { bg: "#FEF3D6", text: "#B45309" },
  "not started": { bg: "#EEF0F3", text: "#5A6472" },
  done: { bg: "#DFF3E6", text: "#17734A" },
};

function getStyle(label) {
  return STATUS_STYLES[(label || "").toLowerCase()] || { bg: "#EEF0F3", text: "#5A6472" };
}

export default function StatusCell({ value, options, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);

  const choices = options?.choices || [
    { label: "Not Started" },
    { label: "In Progress" },
    { label: "In Review" },
    { label: "Blocked" },
    { label: "Done" },
  ];

  const currentLabel = value || choices[0]?.label || "";
  const style = getStyle(currentLabel);

  if (isEditing) {
    return (
      <Select
        value={currentLabel}
        onValueChange={(newValue) => {
          onUpdate(newValue);
          setIsEditing(false);
        }}
        onOpenChange={(open) => {
          if (!open) setIsEditing(false);
        }}
        open={true}
      >
        <SelectTrigger className="w-full border-none p-0 h-auto focus:ring-0 shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => {
            const s = getStyle(choice.label);
            return (
              <SelectItem key={choice.label} value={choice.label}>
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: s.bg, color: s.text }}
                >
                  {choice.label}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap"
      style={{ backgroundColor: style.bg, color: style.text }}
      onClick={() => setIsEditing(true)}
    >
      {currentLabel}
    </span>
  );
}

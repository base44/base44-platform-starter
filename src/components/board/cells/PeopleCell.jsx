import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { User } from "lucide-react";

export default function PeopleCell({ value, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");

  const handleSave = () => {
    onUpdate(editValue);
    setIsEditing(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(value || "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyPress}
        className="border-none bg-transparent p-0 h-auto focus:ring-0 text-[#1E1F21]"
        placeholder="Enter name..."
        autoFocus
      />
    );
  }

  if (!value) {
    return (
      <div
        className="cursor-pointer text-[#6D6E6F] hover:bg-[#EDEDED] hover:rounded px-2 py-1 -mx-2 -my-1 transition-colors flex items-center gap-2"
        onClick={() => setIsEditing(true)}
      >
        <User className="w-4 h-4" />
        <span>Assign</span>
      </div>
    );
  }

  return (
    <div
      className="cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => setIsEditing(true)}
    >
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-[#0E2E56] rounded-full flex items-center justify-center">
          <span className="text-white text-xs font-medium">{value.charAt(0).toUpperCase()}</span>
        </div>
        <span className="text-[#1E1F21] text-sm">{value}</span>
      </div>
    </div>
  );
}

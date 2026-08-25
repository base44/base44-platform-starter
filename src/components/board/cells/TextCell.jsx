import React, { useState } from "react";

export default function TextCell({ value, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || "");

  const handleSave = () => {
    onUpdate(editValue);
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSave();
    else if (e.key === "Escape") {
      setEditValue(value || "");
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        autoFocus
        placeholder="Enter text…"
        className="w-full text-sm text-[#1E1F21] bg-white border border-[#D5D9E0] rounded-[8px] px-2 py-1 outline-none focus:border-[#0E2E56] focus:ring-1 focus:ring-[#0E2E56]/20 placeholder-[#9AA3B0] font-normal transition-colors"
      />
    );
  }

  return (
    <div
      className="cursor-pointer text-sm text-[#1E1F21] font-normal truncate w-full px-1 py-0.5 rounded hover:bg-[#F7F9FB] transition-colors"
      onClick={() => {
        setEditValue(value || "");
        setIsEditing(true);
      }}
    >
      {value ? <span>{value}</span> : <span className="text-[#9AA3B0]">Enter text…</span>}
    </div>
  );
}

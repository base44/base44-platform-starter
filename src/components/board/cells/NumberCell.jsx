import React, { useState, useEffect, useRef } from "react";

function getProgressColor(pct) {
  if (pct >= 80) return "#2FA968";
  if (pct >= 40) return "#F5A623";
  return "#E5484D";
}

export default function NumberCell({ value, onUpdate, options }) {
  const [currentValue, setCurrentValue] = useState(value ?? 0);
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef(null);
  const isProgress = options?.format === "progress" || options?.isProgress;

  useEffect(() => {
    setCurrentValue(value ?? 0);
  }, [value]);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const num = parseFloat(currentValue) || 0;
    if (num !== parseFloat(value)) onUpdate(num);
    setCurrentValue(num);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleBlur();
    else if (e.key === "Escape") {
      setIsEditing(false);
      setCurrentValue(value ?? 0);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={currentValue}
        onChange={(e) => setCurrentValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-full text-sm text-[#1E1F21] bg-white border border-[#D5D9E0] rounded-[8px] px-2 py-1 outline-none focus:border-[#0E2E56] focus:ring-1 focus:ring-[#0E2E56]/20 font-normal transition-colors"
      />
    );
  }

  if (isProgress) {
    const pct = Math.min(100, Math.max(0, Number(currentValue) || 0));
    const fillColor = getProgressColor(pct);
    return (
      <div
        className="flex items-center gap-2 w-full cursor-pointer"
        onClick={() => setIsEditing(true)}
      >
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: "#EEF0F3" }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: fillColor }}
          />
        </div>
        <span
          className="text-xs font-medium w-7 text-right flex-shrink-0"
          style={{ color: fillColor }}
        >
          {pct}%
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className="cursor-pointer text-sm text-[#1E1F21] w-full px-1 py-0.5 rounded hover:bg-[#F7F9FB] transition-colors"
    >
      {Number(currentValue).toLocaleString()}
    </div>
  );
}

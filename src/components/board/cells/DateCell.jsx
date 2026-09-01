import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";
import { format } from "date-fns";
import {
  MAX_DATE,
  MIN_DATE,
  isDateInputValid,
  parseCellDate,
  toDateInputValue,
} from "@/lib/taskStats";

const RANGE_HINT = `Enter a date between ${MIN_DATE.slice(0, 4)} and ${MAX_DATE.slice(0, 4)}`;

export default function DateCell({ value, onUpdate }) {
  const date = parseCellDate(value);
  const [isEditing, setIsEditing] = useState(false);
  // The modal's calendar stores a full ISO timestamp, which a date input won't
  // show — normalise to the `YYYY-MM-DD` it reads.
  const [editValue, setEditValue] = useState(toDateInputValue(date));

  // Empty clears the cell; anything else has to be a day the rest of the board
  // can read. `min`/`max` mark an out-of-range year invalid but still hand it
  // over in `value`, so the guard is here rather than on the input alone.
  const isValid = editValue === "" || isDateInputValid(editValue);

  const startEditing = () => {
    setEditValue(toDateInputValue(date));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setEditValue(toDateInputValue(date));
    setIsEditing(false);
  };

  const handleSave = () => {
    if (!isValid) {
      cancelEditing();
      return;
    }
    onUpdate(editValue);
    setIsEditing(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      // An invalid entry stays put with its hint showing rather than committing.
      if (isValid) handleSave();
    } else if (e.key === "Escape") {
      cancelEditing();
    }
  };

  if (isEditing) {
    return (
      <div className="relative">
        <Input
          type="date"
          min={MIN_DATE}
          max={MAX_DATE}
          value={editValue}
          aria-invalid={!isValid}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyPress}
          className={`border-none bg-transparent p-0 h-auto focus:ring-0 ${
            isValid ? "text-[#1E1F21]" : "text-[#F06A6A]"
          }`}
          autoFocus
        />
        {!isValid && (
          <p className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-[#F06A6A] px-2 py-1 text-xs text-white shadow">
            {RANGE_HINT}
          </p>
        )}
      </div>
    );
  }

  if (!date) {
    // Either empty, or a value this cell can't read — an import, or a row
    // written before the cell validated its input. Both are fixed by editing.
    return (
      <div
        className="cursor-pointer text-[#6D6E6F] hover:bg-[#EDEDED] hover:rounded px-2 py-1 -mx-2 -my-1 transition-colors flex items-center gap-2"
        onClick={startEditing}
        title={value ? `${value} — ${RANGE_HINT}` : undefined}
      >
        <Calendar className="w-4 h-4" />
        <span>{value ? "Invalid date" : "Set date"}</span>
      </div>
    );
  }

  const today = new Date();
  const isOverdue = date < today && date.toDateString() !== today.toDateString();

  return (
    <div
      className={`cursor-pointer hover:opacity-80 transition-opacity px-2 py-1 -mx-2 -my-1 rounded text-sm ${
        isOverdue ? "bg-[#F06A6A]/10 text-[#F06A6A]" : "text-[#1E1F21]"
      }`}
      onClick={startEditing}
    >
      {format(date, "MMM d")}
    </div>
  );
}

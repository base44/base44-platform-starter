import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import { motion } from "framer-motion";

export default function SortMenu({ sortBy, sortDirection, columns, onChange, onClose }) {
  const sortOptions = [
    { id: "title", label: "Task Name", type: "text" },
    { id: "created_date", label: "Created Date", type: "date" },
    { id: "updated_date", label: "Updated Date", type: "date" },
    ...columns.map((col) => ({ id: col.id, label: col.title, type: col.type })),
  ];

  const handleSort = (field) => {
    const newDirection = sortBy === field && sortDirection === "asc" ? "desc" : "asc";
    onChange(field, newDirection);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="absolute top-full left-0 mt-2 z-50"
    >
      <Card className="w-64 shadow-lg border-[#EDEDED]">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg font-bold text-[#1E1F21]">Sort By</CardTitle>
          <button onClick={onClose} className="text-[#6D6E6F] hover:text-[#1E1F21]">
            <X className="w-4 h-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-1">
          {sortOptions.map((option) => (
            <Button
              key={option.id}
              variant="ghost"
              className={`w-full justify-between h-auto p-3 ${
                sortBy === option.id ? "bg-[#EDEDED] text-[#0E2E56]" : "hover:bg-[#F6F6F6]"
              }`}
              onClick={() => handleSort(option.id)}
            >
              <span>{option.label}</span>
              {sortBy === option.id &&
                (sortDirection === "asc" ? (
                  <ArrowUp className="w-4 h-4" />
                ) : (
                  <ArrowDown className="w-4 h-4" />
                ))}
            </Button>
          ))}
        </CardContent>
      </Card>
    </motion.div>
  );
}

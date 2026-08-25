import React, { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Board, Item } from "@/lib/entityClient";
import { Upload, Loader2, AlertCircle, CheckCircle2, FileText } from "lucide-react";

// Reserved column names (case-insensitive)
const RESERVED = {
  itemname: "item_name",
  name: "item_name",
  title: "item_name",
  task: "item_name",
  taskname: "item_name",
  group: "group",
  itemid: "item_id",
  parentid: "parent_id",
};
// Well-known fields that map to specific column types
const KNOWN_TYPES = {
  status: "status",
  priority: "priority",
  owner: "people",
  "start date": "date",
  "due date": "date",
  description: "text",
};

const GROUP_COLORS = [
  "#0073EA",
  "#00C875",
  "#E2445C",
  "#FDAB3D",
  "#9D50DD",
  "#037F4C",
  "#CAB641",
  "#FF5AC4",
  "#BB3354",
  "#7F5347",
];

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped quotes ""
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "File must have a header row and at least one data row." };

  const rawHeaders = parseCSVLine(lines[0]).map((h) => h.replace(/^\uFEFF/, ""));

  // Map each header to its role
  const headerMeta = rawHeaders.map((h) => {
    const key = h.toLowerCase().replace(/\s+/g, "");
    const reserved = RESERVED[key];
    return { original: h, reserved: reserved || null };
  });

  // Validate: Item Name is required
  const itemNameIdx = headerMeta.findIndex((m) => m.reserved === "item_name");
  if (itemNameIdx === -1) {
    return {
      error:
        'Missing required column: "Item Name" (or "Name" / "Title" / "Task"). Please add one to your CSV.',
    };
  }

  const groupIdx = headerMeta.findIndex((m) => m.reserved === "group");

  // Build dynamic column definitions (non-reserved only)
  const dynamicHeaders = headerMeta.map((m, i) => ({ ...m, idx: i })).filter((m) => !m.reserved);

  const columns = dynamicHeaders.map((m, i) => ({
    id: `col_${i}`,
    title: m.original,
    type: KNOWN_TYPES[m.original.toLowerCase()] || "text",
    width: 150,
  }));

  // Build column lookup: original header → column id
  const colIdByHeader = {};
  dynamicHeaders.forEach((m, i) => {
    colIdByHeader[m.original] = `col_${i}`;
  });

  // Parse rows
  const groupMap = {}; // name → group object
  const groupOrder = [];
  const items = [];

  const getOrCreateGroup = (name) => {
    if (!groupMap[name]) {
      const g = {
        id: `g_${groupOrder.length}`,
        title: name,
        color: GROUP_COLORS[groupOrder.length % GROUP_COLORS.length],
        collapsed: false,
      };
      groupMap[name] = g;
      groupOrder.push(g);
    }
    return groupMap[name];
  };

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const itemName = row[itemNameIdx]?.trim();
    if (!itemName) continue; // skip rows with no item name

    const groupName = groupIdx !== -1 ? row[groupIdx]?.trim() || "Default Group" : "Default Group";
    const group = getOrCreateGroup(groupName);

    const data = {};
    dynamicHeaders.forEach((m) => {
      const val = row[m.idx]?.trim();
      if (val) data[colIdByHeader[m.original]] = val;
    });

    // Item ID / Parent ID stay *reserved* — recognised, so they never become board
    // columns — but they are not written. Item has no field for them and
    // /api/entities rejects an unknown field rather than dropping it the way
    // Base44 did, so sending them 400'd the whole import. Nothing consumed them:
    // the parent/child hierarchy they were meant to feed was never built.
    items.push({ group_id: group.id, title: itemName, data, order_index: items.length });
  }

  if (groupOrder.length === 0) getOrCreateGroup("Default Group");

  // Prepend the built-in task (item name) column that the board renderer expects
  const taskColumn = { id: "task", title: "Item", type: "text", width: 250 };
  return { columns: [taskColumn, ...columns], groups: groupOrder, items };
}

export default function ImportBoardModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [boardName, setBoardName] = useState("");
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setParseError(null);
    setBoardName("");
    setImporting(false);
    setDone(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setParseError(null);
    setPreview(null);
    if (!boardName) setBoardName(f.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = parseCSV(e.target.result);
      if (result.error) {
        setParseError(result.error);
      } else {
        setPreview(result);
      }
    };
    reader.readAsText(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith(".csv")) handleFile(f);
  };

  const handleImport = async () => {
    if (!preview || !boardName.trim()) return;
    setImporting(true);
    setParseError(null);
    let board = null;
    try {
      board = await Board.create({
        title: boardName.trim(),
        columns: preview.columns,
        groups: preview.groups,
      });
      if (preview.items.length > 0) {
        await Item.bulkCreate(preview.items.map((item) => ({ ...item, board_id: board.id })));
      }
      setDone(true);
      onImported?.(board);
    } catch (err) {
      // The board is created before its items, so a failure here would otherwise
      // leave an empty board behind — and, with no catch at all, leave it behind
      // silently. Roll it back so a retry starts clean.
      if (board) await Board.delete(board.id).catch(() => {});
      setParseError(err?.message || "Import failed — nothing was created.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import board from CSV</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="text-sm font-medium text-foreground">Board imported successfully!</p>
            <button
              onClick={handleClose}
              className="mt-2 text-sm bg-primary text-primary-foreground px-4 py-2 rounded hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Upload a CSV with any columns. <strong>Item Name</strong> (or "Name" / "Title" /
              "Task") is required. <strong>Group</strong> becomes the board's groups.{" "}
              <strong>Item ID</strong> and <strong>Parent ID</strong> are recognised and skipped.
              All other columns are imported as board fields automatically.
            </p>

            {/* Drop zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg py-8 flex flex-col items-center gap-2 cursor-pointer hover:border-primary/40 hover:bg-secondary/30 transition-colors"
            >
              {file ? (
                <>
                  <FileText className="w-6 h-6 text-primary" />
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">Click to replace</p>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drop a CSV file here or click to browse
                  </p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files[0])}
              />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 rounded p-3">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {parseError}
              </div>
            )}

            {preview && (
              <>
                {/* Board name */}
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">
                    Board name
                  </label>
                  <input
                    value={boardName}
                    onChange={(e) => setBoardName(e.target.value)}
                    className="w-full border border-input rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Preview summary */}
                <div className="bg-secondary/40 rounded p-3 text-xs space-y-1 text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">{preview.groups.length}</span>{" "}
                    group{preview.groups.length !== 1 ? "s" : ""}
                  </p>
                  <p>
                    <span className="font-medium text-foreground">{preview.items.length}</span> item
                    {preview.items.length !== 1 ? "s" : ""}
                  </p>
                  {preview.columns.length > 0 && (
                    <p>
                      <span className="font-medium text-foreground">{preview.columns.length}</span>{" "}
                      extra column{preview.columns.length !== 1 ? "s" : ""}:{" "}
                      {preview.columns.map((c) => c.title).join(", ")}
                    </p>
                  )}
                </div>

                <button
                  onClick={handleImport}
                  disabled={importing || !boardName.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium py-2 rounded hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {importing ? "Importing…" : "Import board"}
                </button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

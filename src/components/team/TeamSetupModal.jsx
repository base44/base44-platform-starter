import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Team } from "@/lib/entityClient";
import { Loader2, Users } from "lucide-react";
import InviteTeamModal from "@/components/dashboard/InviteTeamModal";

export default function TeamSetupModal({ open, onClose, onSaved, existingTeam }) {
  const [name, setName] = useState(existingTeam?.name || "");
  const [description, setDescription] = useState(existingTeam?.description || "");
  const [color, setColor] = useState(existingTeam?.color || "#0073EA");
  const [saving, setSaving] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [savedTeam, setSavedTeam] = useState(existingTeam || null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data = { name: name.trim(), description, color };
      let team;
      if (existingTeam) {
        team = await Team.update(existingTeam.id, data);
        team = { ...existingTeam, ...data };
      } else {
        team = await Team.create(data);
      }
      setSavedTeam(team);
      onSaved?.(team);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const COLORS = ["#0073EA", "#00C875", "#E2445C", "#FDAB3D", "#9D50DD", "#037F4C", "#FF5AC4"];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existingTeam ? "Edit Team" : "Create a Team"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Team name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Product Team"
              className="w-full border border-input rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team work on?"
              rows={2}
              className="w-full border border-input rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-xs font-medium text-foreground mb-2 block">Team color</label>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? "scale-125 ring-2 ring-offset-1 ring-foreground/30" : "hover:scale-110"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 border border-border text-sm font-medium py-2 rounded hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            {existingTeam && (
              <button
                onClick={() => setShowInvite(true)}
                className="flex items-center justify-center gap-2 border border-border text-sm font-medium px-4 py-2 rounded hover:bg-secondary transition-colors"
              >
                <Users className="w-4 h-4" />
                Invite
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground text-sm font-medium py-2 rounded hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {existingTeam ? "Save changes" : "Create team"}
            </button>
          </div>
        </div>
      </DialogContent>
      <InviteTeamModal
        isOpen={showInvite}
        onClose={() => setShowInvite(false)}
        team={savedTeam || existingTeam}
      />
    </Dialog>
  );
}

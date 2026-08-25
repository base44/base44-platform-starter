import React from "react";
import { Users, Pencil } from "lucide-react";

export default function TeamBanner({ team, onEdit }) {
  if (!team) return null;

  const initials = team.name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="rounded-xl border border-border p-4 flex items-center gap-4 shadow-sm"
      style={{ background: `linear-gradient(135deg, ${team.color}18 0%, ${team.color}08 100%)` }}
    >
      {/* Logo / initials */}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm"
        style={{ backgroundColor: team.color }}
      >
        {team.logo_url ? (
          <img src={team.logo_url} alt={team.name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-white text-base font-bold">{initials}</span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground truncate">{team.name}</p>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="w-3 h-3" />
            {(team.member_emails?.length || 0) + 1} member
            {(team.member_emails?.length || 0) !== 0 ? "s" : ""}
          </span>
        </div>
        {team.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{team.description}</p>
        )}
      </div>

      <button
        onClick={onEdit}
        className="p-1.5 rounded hover:bg-black/5 transition-colors text-muted-foreground hover:text-foreground flex-shrink-0"
        title="Edit team"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

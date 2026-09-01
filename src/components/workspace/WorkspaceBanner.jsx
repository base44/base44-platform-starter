import React from "react";
import { WORKSPACE_BRAND } from "@/lib/workspaceBrand";

/**
 * Branding, not membership: the shell's own name over the signed-in user's own
 * boards. It shows no member count, because there is nobody else in here — see
 * src/lib/workspaceBrand.ts.
 */
export default function WorkspaceBanner() {
  const { name, description, color } = WORKSPACE_BRAND;

  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="rounded-xl border border-border p-4 flex items-center gap-4 shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)` }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden shadow-sm"
        style={{ backgroundColor: color }}
      >
        <span className="text-white text-base font-bold">{initials}</span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground truncate">{name}</p>
        {description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{description}</p>
        )}
      </div>
    </div>
  );
}

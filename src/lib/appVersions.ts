/**
 * What a saved version is to the app right now, derived rather than stored.
 *
 * Base44 reports the app's current build as `last_git_commit_hash` and the
 * published one as `last_deployed_git_commit_hash`; a version carries its own
 * `git_commit_hash`. Matching hashes is the only honest way to label a row,
 * because `last_deployed_at` on a checkpoint says it was published once, not
 * that it is live now — a later publish moves production without touching it.
 */

import type { Checkpoint } from "@/lib/base44Platform";

export type VersionApp = {
  id?: string;
  last_git_commit_hash?: string | null;
  last_deployed_git_commit_hash?: string | null;
  status?: { state?: string | null } | null;
};

export type PreviewState = "ready" | "building" | "failed" | "none";

export type VersionState = {
  /** The build the editor is on. Restoring it re-runs the whole restore anyway. */
  current: boolean;
  /** The build production serves. */
  live: boolean;
  preview: PreviewState;
};

export function previewState(checkpoint: Pick<Checkpoint, "preview_status" | "preview_url">): PreviewState {
  switch (checkpoint.preview_status) {
    case "ready":
      return checkpoint.preview_url ? "ready" : "none";
    case "pending":
    case "building":
      return "building";
    case "failed":
      return "failed";
    default:
      return "none";
  }
}

export function versionState(app: VersionApp | null | undefined, checkpoint: Checkpoint): VersionState {
  const hash = checkpoint.git_commit_hash ?? null;
  return {
    current: Boolean(hash) && hash === (app?.last_git_commit_hash ?? null),
    live: Boolean(hash) && hash === (app?.last_deployed_git_commit_hash ?? null),
    preview: previewState(checkpoint),
  };
}

/** A version's display name. The builder names most of them after the turn's message. */
export function versionTitle(checkpoint: Pick<Checkpoint, "name" | "changes">): string {
  const name = checkpoint.name?.trim();
  if (name && name !== "untitled") return name;
  return checkpoint.changes?.trim() || "Untitled version";
}

/**
 * Restore is refused with a 409 while a builder turn is running, so the UI
 * disables it rather than letting the user find out from the error.
 */
export function restoreBlocked(app: VersionApp | null | undefined): boolean {
  return app?.status?.state === "processing";
}

/**
 * The sentence to show for a failed restore or publish-version call. Upstream
 * answers 409 for a running turn, a protected main line and a version from
 * another branch; the detail text is the clearest source for which it was.
 */
export function versionActionError(
  action: "restore" | "publish",
  status: number | null,
  detail: string,
): string {
  if (status === 409) {
    if (/working|processing|generating/i.test(detail)) {
      return "The app is still building. Wait for it to finish, then try again.";
    }
    if (/branch/i.test(detail)) {
      return action === "restore"
        ? "This version belongs to a different branch of the app, so it can't be restored here."
        : "This version belongs to a branch, so it can't be published. Merge the branch first.";
    }
    return "The app is busy. Wait a moment, then try again.";
  }
  if (status === 404) return "This version no longer exists.";
  if (status === 400 && /compile/i.test(detail)) {
    return "This version's backend functions no longer compile, so it can't be published.";
  }
  return action === "restore"
    ? "The version could not be restored. Try again."
    : "The version could not be published. Try again.";
}

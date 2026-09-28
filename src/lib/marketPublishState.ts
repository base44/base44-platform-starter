/** Whether the current build is the one offered in the market. */
export function marketPublishState(app: {
  last_deployed_at?: string | null;
  last_git_commit_hash?: string | null;
  last_deployed_git_commit_hash?: string | null;
  updated_date?: string | null;
}, listing?: { status?: string; published_date?: string | null } | null, editPending = false) {
  if (listing?.status !== "published") return "unlisted";
  if (editPending || !app.last_deployed_at || !listing.published_date) return "needs_publish";

  const publishedAt = Date.parse(listing.published_date);
  const deployedAt = Date.parse(app.last_deployed_at);
  if (!Number.isFinite(publishedAt) || !Number.isFinite(deployedAt) || deployedAt > publishedAt) {
    return "needs_publish";
  }
  if (app.last_git_commit_hash && app.last_deployed_git_commit_hash &&
      app.last_git_commit_hash !== app.last_deployed_git_commit_hash) return "needs_publish";
  if (app.updated_date && Date.parse(app.updated_date) > publishedAt) return "needs_publish";
  return "live";
}

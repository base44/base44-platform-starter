/** Adapter from the starter's browser actions to the SDK's public contract. */
import type { PlatformApp, PlatformUserClient } from "@base44/sdk/platform/server";
import { appsFolderId, resolveAppSecrets } from "@/lib/base44Config";

export const SDK_APP_ACTIONS = new Set(["listApps", "createApp", "getApp", "renameApp", "fileAppsInFolder", "getPreviewUrl", "deployApp"]);
function appResponse(app: PlatformApp) {
  return {
    id: app.id, name: app.name, slug: app.slug, status: { state: app.state },
    updated_date: app.updatedAt, preview_screenshot_url: app.previewScreenshotUrl, logo_url: app.logoUrl,
    last_deployed_at: app.lastDeployedAt, last_git_commit_hash: app.currentRevision,
    last_deployed_git_commit_hash: app.deployedRevision, has_custom_instructions: app.hasCustomInstructions,
  };
}
export async function runAppOperation(user: PlatformUserClient, action: string, p: Record<string, unknown>) {
  const appId = String(p.appId ?? "");
  switch (action) {
    case "listApps": return (await user.apps.list({ folderId: appsFolderId(), limit: Number(p.limit) > 0 ? Number(p.limit) : 20, skip: Number(p.skip) || 0 })).map(appResponse);
    case "createApp": return appResponse(await user.apps.create({
      prompt: String(p.prompt), name: p.name ? String(p.name) : undefined,
      customInstructions: p.customInstructions ? String(p.customInstructions) : undefined,
      secrets: resolveAppSecrets(p.secrets as string[] | undefined ?? []),
      publicSettings: "public_without_login", preventIframeEmbedding: false,
    }));
    case "getApp": return appResponse(await user.apps.get(appId));
    case "renameApp": return appResponse(await user.apps.rename(appId, String(p.name)));
    case "fileAppsInFolder": await user.apps.addToFolder(appsFolderId(), p.appIds as string[]); return { ok: true };
    case "getPreviewUrl": {
      const preview = await user.apps.getPreviewUrl(appId);
      return { preview_url: preview.url, preview_token: preview.token };
    }
    case "deployApp": {
      const result = await user.apps.deploy(appId);
      return { app_id: result.appId, checkpoint_id: result.checkpointId, git_commit_hash: result.revision, deployed_at: result.deployedAt };
    }
    default: throw new Error("Unsupported SDK app action");
  }
}

/** Map Sunny's validated browser actions to the platform SDK. */
import type { PlatformApp, PlatformUserClient } from "@base44/sdk/platform/server";
import { appsFolderId, resolveAppSecrets } from "@/lib/base44Config";

export const SDK_APP_ACTIONS = new Set([
  "listApps",
  "createApp",
  "getApp",
  "renameApp",
  "fileAppsInFolder",
  "getPreviewUrl",
  "deployApp",
]);

export async function runAppOperation(
  user: PlatformUserClient,
  action: string,
  params: Record<string, unknown>,
) {
  const appId = String(params.appId ?? "");

  switch (action) {
    case "listApps": {
      const apps = await user.apps.list({
        folderId: appsFolderId(),
        limit: Number(params.limit) > 0 ? Number(params.limit) : 20,
        skip: Number(params.skip) || 0,
      });
      return apps.map(toBrowserApp);
    }
    case "createApp": {
      const secretNames = (params.secrets as string[] | undefined) ?? [];
      const app = await user.apps.create({
        prompt: String(params.prompt),
        name: params.name ? String(params.name) : undefined,
        customInstructions: params.customInstructions ? String(params.customInstructions) : undefined,
        secrets: resolveAppSecrets(secretNames),
        publicSettings: "public_without_login",
        preventIframeEmbedding: false,
      });
      return toBrowserApp(app);
    }
    case "getApp": {
      const app = await user.apps.get(appId);
      return toBrowserApp(app);
    }
    case "renameApp": {
      const app = await user.apps.rename(appId, String(params.name));
      return toBrowserApp(app);
    }
    case "fileAppsInFolder": {
      await user.apps.addToFolder(appsFolderId(), params.appIds as string[]);
      return { ok: true };
    }
    case "getPreviewUrl": {
      const preview = await user.apps.getPreviewUrl(appId);
      return { preview_url: preview.url, preview_token: preview.token };
    }
    case "deployApp": {
      const deployment = await user.apps.deploy(appId);
      return {
        app_id: deployment.appId,
        checkpoint_id: deployment.checkpointId,
        git_commit_hash: deployment.revision,
        deployed_at: deployment.deployedAt,
      };
    }
    default:
      throw new Error("Unsupported SDK app action");
  }
}

/** Preserve Sunny's browser contract while the SDK uses camelCase names. */
function toBrowserApp(app: PlatformApp) {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    status: { state: app.state },
    updated_date: app.updatedAt,
    preview_screenshot_url: app.previewScreenshotUrl,
    logo_url: app.logoUrl,
    last_deployed_at: app.lastDeployedAt,
    last_git_commit_hash: app.currentRevision,
    last_deployed_git_commit_hash: app.deployedRevision,
    has_custom_instructions: app.hasCustomInstructions,
  };
}

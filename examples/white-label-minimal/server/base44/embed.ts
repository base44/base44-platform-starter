import "server-only";
import { Base44Error } from "./error";
import { base44, workspaceKey } from "./request";

// "Embed the app": https://docs.base44.com/developers/white-label/embed-the-app
// Signs a viewer into one version of an app. The URL works once and expires in
// 60 seconds. The email must come from your session, never from the browser.
export async function getEmbedUrl(
  appId: string,
  email: string,
  target: "live_site" | "latest_preview" | "live_preview",
) {
  const auth = { api_key: workspaceKey() };
  try {
    // Provisioning is idempotent, so it is safe before every mint.
    await base44(`/api/apps/${appId}/users/provisions`, {
      method: "POST",
      auth,
      body: { email, role: "user" },
    });
    const token = await base44(`/api/apps/${appId}/embed-tokens`, {
      method: "POST",
      auth,
      body: { email, target },
    });
    return { url: token.embed_url as string };
  } catch (error) {
    // For example app_has_no_slug before the first build: nothing to show yet.
    if (error instanceof Base44Error && error.status < 500) {
      console.warn(`[embed] ${appId} ${target}: ${error.status} ${error.code ?? ""}`);
      return { url: null };
    }
    throw error;
  }
}

import "server-only";
import { getBase44Config } from "./config";

// "Embed the app": https://docs.base44.com/developers/white-label/embed-the-app
// Signs a viewer into one version of an app with a one-time URL. Uses the
// workspace key, which needs the Provision app users and Mint embed sign-in
// tokens permissions. The email must come from your session, never the browser.
export async function getEmbedUrl(
  appId: string,
  email: string,
  target: "live_site" | "latest_preview" | "live_preview",
): Promise<{ url: string | null }> {
  const app = `/api/apps/${encodeURIComponent(appId)}`;
  // Idempotent, so it is safe before every mint.
  if (!(await post(`${app}/users/provisions`, { email, role: "user" }))) return { url: null };
  const minted = await post(`${app}/embed-tokens`, { email, target });
  // The token works once and expires in 60 seconds: load it right away.
  return { url: typeof minted?.embed_url === "string" ? minted.embed_url : null };
}

// Returns null when Base44 refuses, for example app_has_no_slug before the
// first build. The caller then shows the screenshot instead.
async function post(path: string, body: object) {
  const { host, workspaceId } = getBase44Config();
  const key = process.env.BASE44_SVC_KEY?.trim();
  if (!key) return null;
  try {
    const response = await fetch(`${host}${path}`, {
      method: "POST",
      headers: { api_key: key, "X-Active-Workspace-Id": workspaceId, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return await response.json();
    const code = await response.json().then((b) => b?.error?.code, () => undefined);
    console.warn(`[embed] ${path} → ${response.status}${code ? ` ${code}` : ""}`);
  } catch {
    console.warn(`[embed] ${path} → no response`);
  }
  return null;
}

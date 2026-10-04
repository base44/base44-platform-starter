import "server-only";
import { Base44Error } from "./error";

// One Base44 account owns every app. Its personal access token must come from
// your enterprise workspace, with access to all apps and full permission.
// The workspace key is optional: it signs builders into previews and opens
// live updates.
export function getBase44Config() {
  const token = process.env.BASE44_ACCESS_TOKEN?.trim();
  const workspaceId = process.env.BASE44_WORKSPACE_ID?.trim();
  let host: URL;
  try {
    host = new URL(process.env.BASE44_PLATFORM_HOST || "");
  } catch {
    throw new Base44Error("The Base44 connection is not configured.", 503);
  }
  // A bare origin only: no credentials, path, query, or fragment.
  if (host.protocol !== "https:" || host.href !== `${host.origin}/`) {
    throw new Base44Error("The Base44 connection requires an HTTPS platform origin.", 503);
  }
  if (!token || !workspaceId) throw new Base44Error("The Base44 connection is not configured.", 503);
  return { host: host.origin, token, workspaceId, workspaceKey: process.env.BASE44_SVC_KEY?.trim() };
}

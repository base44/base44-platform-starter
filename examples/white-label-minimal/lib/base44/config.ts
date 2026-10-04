import "server-only";
import { Base44Error } from "./error";

export function getBase44Config() {
  let host: URL;
  try {
    host = new URL(process.env.BASE44_PLATFORM_HOST || "");
  } catch {
    throw new Base44Error("The workspace connection is not configured.", 503);
  }
  // A bare origin only: no credentials, path, query, or fragment.
  if (host.protocol !== "https:" || host.href !== `${host.origin}/`) {
    throw new Base44Error("The workspace connection requires an HTTPS platform origin.", 503);
  }
  return { host: host.origin };
}

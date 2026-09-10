import "server-only";
import { Base44Error } from "./base44-error";

export function getBase44Config() {
  let host: URL;
  try {
    host = new URL(process.env.BASE44_PLATFORM_HOST || "");
  } catch {
    throw new Base44Error("The workspace connection is not configured.", 503);
  }
  if (
    host.protocol !== "https:" ||
    host.username ||
    host.password ||
    host.pathname !== "/" ||
    host.search ||
    host.hash
  ) {
    throw new Base44Error("The workspace connection requires an HTTPS platform origin.", 503);
  }
  return { host: host.origin };
}


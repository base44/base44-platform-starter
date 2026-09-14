import "server-only";
import { getLink, remint } from "@/lib/base44Link";
import { Base44Error } from "./base44-error";

// Callers must supply the email from a verified server session, never request data.
export { connect, disconnect, getLink, linkStatus } from "@/lib/base44Link";

export async function getBase44AccessToken(email: string): Promise<string> {
  let link = await getLink(email);
  if (link?.status !== "linked" || !link.accessToken)
    throw new Base44Error("Connect your workspace to start building.", 428);
  if (!link.expiresAt || link.expiresAt.getTime() < Date.now() + 60_000)
    link = await remint(link);
  if (!link?.accessToken)
    throw new Base44Error("Reconnect your workspace to continue.", 428);
  return link.accessToken;
}

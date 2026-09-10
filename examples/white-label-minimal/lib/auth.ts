import "server-only";
import { getSessionUser } from "@/lib/auth";
import { Base44Error } from "./base44-error";

// Sunny's Google/Auth.js login owns the session. It never provisions Base44 users.
export { getSessionUser, handlers } from "@/lib/auth";

export async function requireSunnyUser() {
  const user = await getSessionUser();
  if (!user) throw new Base44Error("Sign in to continue.", 401);
  return user;
}

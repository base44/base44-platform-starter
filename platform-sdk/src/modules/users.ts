import type { RequestOptions } from "../types";
import { Transport } from "../transport";
import { Tokens } from "../tokens";
import { Base44PlatformError } from "../errors";
import { externalId, object, requiredString, boolean, badResponse } from "../validation";

/** Input for an explicitly requested provisioning operation. */
export interface ProvisionUserInput {
  /** Stable ID from your system; trimmed and lowercased, never a Base44 user ID. */
  externalId: string;
  /** Optional display label visible to workspace administrators; avoid personal data. */
  displayName?: string;
}
/** Synthetic service identity returned by provisioning, not a login-capable account. */
export interface ProvisionedUser {
  /** Canonical ID from your system. */
  externalId: string;
  /** Base44-assigned user ID. */
  userId: string;
  /** Synthetic, non-routable service address; not your customer's email. */
  email: string;
  /** Workspace role returned by Base44; this SDK never requests an elevated role. */
  role: string;
  /** True if created by this request, false if it already existed. */
  created: boolean;
}
/** Outcome of removing a service identity. */
export interface DeprovisionResult {
  /** False if already absent; true if removed. */
  removed: boolean;
}
/** Workspace-level identity operations, authenticated with the configured API key. */
export interface UsersModule {
  /** Explicitly create or return a principal; idempotent within its workspace. */
  provision(input: ProvisionUserInput, options?: RequestOptions): Promise<ProvisionedUser>;
  /** Offboard and clear local tokens. Owned apps may transfer to the workspace owner. */
  deprovision(externalId: string, options?: RequestOptions): Promise<DeprovisionResult>;
}
export function createUsers(transport: Transport, tokens: Tokens, apiKey: string): UsersModule {
  const headers = { Authorization: apiKey, "Content-Type": "application/json" };
  return {
    async provision(input, options) {
      const id = externalId(input.externalId);
      return tokens.exclusive(id, async () => {
        const data = object(await transport.request("/api/service/users", "POST", headers, {
          service_external_id: id, display_name: input.displayName,
        }, options));
        const email = requiredString(data.email);
        const domain = email.split("@")[1]?.toLowerCase();
        if (!domain || !(domain === "svc.base44.invalid" || domain.endsWith(".svc.base44.invalid"))) return badResponse();
        return {
          externalId: requiredString(data.service_external_id), userId: requiredString(data.user_id),
          email, role: requiredString(data.role), created: boolean(data.created),
        };
      });
    },
    async deprovision(value, options) {
      const id = externalId(value);
      return tokens.exclusive(id, async () => {
        let removed: boolean;
        try {
          const data = object(await transport.request(`/api/service/users/${encodeURIComponent(id)}`, "DELETE", headers, undefined, options));
          removed = boolean(data.removed);
        } catch (error) {
          if (!(error instanceof Base44PlatformError) || error.status !== 404) throw error;
          removed = false;
        }
        await tokens.remove(id);
        return { removed };
      });
    },
  };
}

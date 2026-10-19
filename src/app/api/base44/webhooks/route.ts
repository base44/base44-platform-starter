/**
 * POST /api/base44/webhooks — Base44 tells the shell an app was deleted, so its
 * dashboard pins stop framing an app that is gone. Polling can't do this: a pin
 * renders from its own stored url, and `listApps` never reports a deletion.
 *
 * Status codes are instructions to Base44: non-2xx is retried (8 attempts over
 * ~27h) and enough failures auto-pause the endpoint. The SDK's handler picks
 * them: 400 for a delivery that fails verification, 500 for missing keys or a
 * handler that threw, 204 otherwise, including event types with no handler. It
 * answers the `webhook.test.v1` activation probe itself, after verifying it.
 */

import { WebhookVerificationError } from "@base44/platform/server";
import { NextResponse } from "next/server";

import { ownersOf } from "@/lib/appOwnership";
import { verifyOptions, webhooks } from "@/lib/base44Webhooks";
import { deleteEntity, listEntities } from "@/lib/entityCrud";

// Prisma, so not the edge runtime.
export const runtime = "nodejs";

/**
 * The event names the app; `AppOwnership` says whose it is. Upstream every app has
 * the same owner — the integration account — so nothing in the payload could name
 * a shell user, and none of it is needed to.
 *
 * Idempotent and order-safe without a ledger: deleting pins that are already
 * gone is a no-op, and a late delete after a restore leaves the same state as
 * an on-time one, since a restore never puts pins back. `AppOwnership` stays —
 * a trashed app already drops out of `listApps`, and a restored one comes back.
 */
async function removePins(appId: string) {
  // Empty for an app built by another tool in the same workspace: nothing of ours to remove.
  for (const email of await ownersOf(appId)) {
    // Scoped through the RLS predicate to one owner at a time.
    const actor = { email, role: "user" } as const;
    for (const row of await listEntities("Widget", actor, { where: { appId } })) {
      if (typeof row.id === "string") await deleteEntity("Widget", actor, row.id);
    }
  }
}

export async function POST(request: Request) {
  let options;
  try {
    options = verifyOptions();
  } catch (err) {
    console.error("[base44-webhook] cannot verify:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "receiver_misconfigured" }, { status: 500 });
  }

  const handle = webhooks.createHandler({
    ...options,
    on: {
      "app.deleted.v1": (event) => removePins(event.data.app_id),
    },
    onError: (err) => {
      if (err instanceof WebhookVerificationError) console.warn("[base44-webhook] rejected:", err.code);
      else console.error("[base44-webhook] failed:", err instanceof Error ? err.message : err);
    },
  });
  return handle(request);
}

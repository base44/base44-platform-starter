/**
 * POST /api/base44/webhooks — Base44 tells the shell an app was deleted, so its
 * dashboard pins stop framing an app that is gone. Polling can't do this: a pin
 * renders from its own stored url, and `listApps` never reports a deletion.
 *
 * Status codes are instructions to Base44: non-2xx is retried (8 attempts over
 * ~27h) and enough failures auto-pause the endpoint, so unhandled types get 2xx.
 */

import { NextResponse } from "next/server";

import { orgId } from "@/lib/base44Config";
import { emailForServiceExternalId } from "@/lib/base44Link";
import { verifyWebhook } from "@/lib/base44WebhookSignature";
import { deleteEntity, listEntities } from "@/lib/entityCrud";

// node:crypto for Ed25519, so not the edge runtime.
export const runtime = "nodejs";

type CloudEvent = { type: string; source?: string; data: Record<string, unknown> };

/**
 * Idempotent and order-safe without a ledger: deleting pins that are already
 * gone is a no-op, and a late delete after a restore leaves the same state as
 * an on-time one, since a restore never puts pins back. `AppOwnership` stays —
 * a trashed app already drops out of `listApps`, and a restored one comes back.
 */
async function removePins(principal: unknown, appId: unknown) {
  if (typeof principal !== "string" || typeof appId !== "string") return;
  // Null for an app built by another tool in the same workspace: nothing of ours to remove.
  const email = await emailForServiceExternalId(principal);
  if (!email) return;
  // Scoped through the RLS predicate to the one owner the verified event names.
  const actor = { email, role: "user" } as const;
  for (const row of await listEntities("Widget", actor, { where: { appId } })) {
    if (typeof row.id === "string") await deleteEntity("Widget", actor, row.id);
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const verified = verifyWebhook(request.headers, rawBody);
    if (!verified.ok) {
      console.warn("[base44-webhook] rejected:", verified.reason);
      return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
    }
  } catch (err) {
    console.error("[base44-webhook] cannot verify:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "receiver_misconfigured" }, { status: 500 });
  }

  const event = JSON.parse(rawBody) as CloudEvent;
  // The signature proves Base44 sent it, not which workspace it was for.
  if (!event.source?.endsWith(`/${orgId()}`)) {
    return NextResponse.json({ error: "unknown_workspace" }, { status: 404 });
  }

  // Activation: echo the challenge, only after the signature verified.
  if (event.type === "webhook.test.v1") {
    return NextResponse.json({ challenge: event.data.challenge });
  }
  if (event.type === "app.deleted.v1") {
    await removePins(event.data.owner_service_external_id, event.data.app_id);
  }
  return NextResponse.json({ ok: true });
}

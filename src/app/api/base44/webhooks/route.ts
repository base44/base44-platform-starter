/**
 * POST /api/base44/webhooks — Base44 tells this shell what happened to the apps
 * its users built.
 *
 * The fifth boundary. The other four are all this shell calling *out* to Base44;
 * this is the one direction where Base44 calls in, and it exists because polling
 * cannot answer the question. `listApps` costs a round trip per page load, lags
 * reality, and **cannot report a deletion at all** — a trashed app simply stops
 * appearing, which is indistinguishable from a failed call. Events carry the
 * transition itself.
 *
 * ## What makes a request trustworthy
 *
 * Nothing about the request except its signature. The URL is public, so the
 * event type, the app id, and above all the `owner_service_external_id` that
 * decides *whose* rows get touched are all attacker-controlled until
 * `verifyWebhook` returns ok. There is no shared secret and no allow-list of
 * source IPs; the Ed25519 signature over the raw body is the whole control.
 *
 * That control carries the weight of a deletion. `app.deleted.v1` removes this
 * shell's rows for the app — the dashboard pins and the ownership register (see
 * src/lib/base44AppMirror.ts) — so a forged event is a data-loss primitive
 * against a named user, not a wrong badge. Nothing below runs before the
 * signature verifies, and the removal is scoped through the RLS predicate to the
 * one owner the verified event names.
 *
 * The body is read **once** as text and passed to both the verifier and the
 * parser. Verifying a re-serialized body is the classic way to make every
 * signature fail — see src/lib/base44WebhookSignature.ts.
 *
 * ## Status codes are instructions to the sender
 *
 * Base44 retries every non-2xx and every timeout, 8 attempts over ~27h35m, and
 * auto-pauses an endpoint that keeps failing. So the code chosen here is an
 * operational decision, not decoration:
 *
 *   * **2xx** — accepted, stop retrying. Also returned for events we do not
 *     handle: a 4xx there would burn the ladder on something we will never
 *     accept and can end with the endpoint paused, losing the events we do want.
 *   * **400** — the signature did not verify. Deliberately not 2xx: a real
 *     mismatch should be visible to whoever is looking at delivery logs, and the
 *     retry costs nothing while a key rotation settles.
 *   * **500** — we accepted it and then failed to store it. Retrying is exactly
 *     right; the row we already wrote makes the retry idempotent.
 *
 * ## Activation
 *
 * Registering an endpoint sends a signed `webhook.test.v1` whose body carries a
 * `challenge`, and activation requires echoing it back. That is not a liveness
 * check: it proves the receiver *read the body*, which stops anyone registering
 * a URL they do not control and having Base44 deliver signed traffic to a third
 * party. We echo only after the signature verifies — a receiver that echoes an
 * unverified challenge has given away the only proof it had that the request
 * came from Base44.
 */

import { NextResponse } from "next/server";

import { orgId } from "@/lib/base44Config";
import {
  ACTIVATION_EVENT,
  type CloudEvent,
  projectEvent,
} from "@/lib/base44WebhookEvents";
import { verifyWebhook } from "@/lib/base44WebhookSignature";
import { prisma } from "@/lib/prisma";

// node:crypto for Ed25519 verification, so this cannot run on the edge runtime.
export const runtime = "nodejs";

/** `source` is `https://base44.com/workspaces/{workspace_id}`. */
function workspaceFromSource(source: string): string | null {
  const tail = source.split("/").pop();
  return tail && tail.length > 0 ? tail : null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  const verified = await verifyWebhook(request.headers, rawBody);
  if (!verified.ok) {
    console.warn("[base44-webhook] rejected:", verified.reason);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  let event: CloudEvent;
  try {
    event = JSON.parse(rawBody) as CloudEvent;
  } catch {
    // Signed by Base44 and still not JSON: nothing to retry into.
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // The signature proves the sender holds the workspace's key, not which
  // workspace it signed for. Asserting the source keeps a second Base44
  // workspace's events out of this deployment's tables.
  const workspaceId = workspaceFromSource(event.source ?? "");
  if (workspaceId !== orgId()) {
    console.warn("[base44-webhook] wrong workspace:", workspaceId);
    return NextResponse.json({ error: "unknown_workspace" }, { status: 404 });
  }

  // The activation probe is about the endpoint, not an app, and predates any
  // subscription — so it is answered before the ledger, and never recorded as
  // app state. `challenge` must come back whole.
  if (event.type === ACTIVATION_EVENT) {
    const challenge = event.data?.challenge;
    if (typeof challenge !== "string") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    return NextResponse.json({ challenge });
  }

  // Claim the event id first. The unique index turns a redelivery into a
  // conflict here rather than a second projection, which is what makes
  // at-least-once delivery safe to apply. The window it does not close is a
  // crash between this claim and the projection below: the retry sees a claimed
  // id and returns early, leaving `processedAt` null. That is on purpose — an
  // unprocessed row is a visible, queryable defect, where re-running a
  // half-applied projection would be a silent one.
  try {
    await prisma.base44WebhookEvent.create({
      data: {
        cloudEventId: event.id,
        eventType: event.type,
        appId: typeof event.data?.app_id === "string" ? event.data.app_id : null,
        workspaceId,
      },
    });
  } catch {
    // Unique violation: already seen. 2xx, or Base44 keeps retrying a duplicate.
    return NextResponse.json({ status: "duplicate" });
  }

  try {
    const outcome = await projectEvent(event);
    await prisma.base44WebhookEvent.update({
      where: { cloudEventId: event.id },
      data: { processedAt: new Date() },
    });
    return NextResponse.json({ status: outcome });
  } catch (err) {
    console.error("[base44-webhook] projection failed:", err);
    // 500 so it is retried. The ledger row stays unprocessed, so the retry is
    // rejected as a duplicate and a human has to look — see the note above.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * GET is here for operators, not for Base44: "is my receiver reachable and
 * seeing traffic". Counts only, no payloads and no owner emails — this route has
 * no session, so anything it returns is public.
 */
export async function GET() {
  const [accepted, unprocessed, trashed, unclaimed, latest] = await Promise.all([
    prisma.base44WebhookEvent.count(),
    prisma.base44WebhookEvent.count({ where: { processedAt: null } }),
    // The payoff, as one number: apps the shell knows are gone. Polling
    // `listApps` can never produce this — a trashed app just stops being listed.
    prisma.base44AppState.count({ where: { lifecycle: "trashed" } }),
    prisma.base44AppState.count({ where: { pendingNotice: { not: null } } }),
    prisma.base44WebhookEvent.findFirst({
      orderBy: { receivedAt: "desc" },
      select: { eventType: true, receivedAt: true },
    }),
  ]);

  return NextResponse.json({
    accepted,
    // Non-zero for more than a few minutes is the thing to alert on.
    unprocessed,
    apps_trashed: trashed,
    // Removals nobody has been shown yet. Ordinary in ones and twos — a notice
    // waits for its owner to open the shell. A number that only grows means the
    // claim path is broken, not that users are ignoring it.
    notices_unclaimed: unclaimed,
    last_event_type: latest?.eventType ?? null,
    last_received_at: latest?.receivedAt ?? null,
  });
}

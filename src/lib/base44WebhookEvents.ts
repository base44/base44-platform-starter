/**
 * Projects a verified Base44 lifecycle event onto `Base44AppState`.
 *
 * The receiver's job is deliberately small: record what Base44 said, and do it
 * fast. Base44 gives a delivery 15s before it counts as a timeout and starts the
 * retry ladder, so anything slow belongs in a job this triggers, never inline —
 * a receiver that does real work on the request path turns its own slowness into
 * duplicate deliveries.
 *
 * Two properties of the event stream shape every handler below:
 *
 *   * **At-least-once, so handlers are idempotent.** Every write is an upsert or
 *     a conditional update; none reads-then-writes on a value it assumes is
 *     still there.
 *   * **Order is not guaranteed.** Retries mean a slow attempt 3 of an earlier
 *     event can land after attempt 1 of a later one. Every apply is gated on the
 *     event's own `time` being newer than what the row has already seen, so a
 *     late arrival cannot move an app backwards — a stale `app.deleted` landing
 *     after a fresh `app.restored` would otherwise re-trash a live app, and now
 *     also tear down the rows that render it.
 *
 * Recording the state is only half of it. `src/lib/base44AppMirror.ts` owns the
 * other half — the rows the shell has to remove or put back, and the notice its
 * owner sees — and runs behind the same staleness gate for that reason.
 */

import type { Base44AppLifecycle, Prisma } from "@prisma/client";

import { mirrorTransition } from "@/lib/base44AppMirror";
import { HANDLED_EVENT_TYPES } from "@/lib/base44WebhookEventTypes";
import { emailForServiceExternalId } from "@/lib/base44Link";
import { prisma } from "@/lib/prisma";

/** The CloudEvents envelope, narrowed to what this receiver reads. */
export type CloudEvent = {
  id: string;
  type: string;
  source: string;
  time: string;
  data: Record<string, unknown>;
};

export const ACTIVATION_EVENT = "webhook.test.v1";

/**
 * Lifecycle events this deployment acts on. An unknown type is accepted and
 * ignored rather than rejected: Base44 adds event types, a 4xx would put this
 * endpoint on the retry ladder for something we will never handle, and enough
 * consecutive failures auto-pause the endpoint — losing the events we *do* care
 * about. Selecting types happens at registration, not here.
 */
const HANDLED = new Set<string>(HANDLED_EVENT_TYPES);

export type ProjectionOutcome = "applied" | "ignored_unknown_type" | "ignored_stale" | "no_app_id";

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * The transition each event type makes. Returns only the fields it owns, so
 * `app.published.v1` cannot silently clear a lifecycle set by a delete.
 */
function transition(event: CloudEvent): Prisma.Base44AppStateUpdateInput {
  const data = event.data;
  switch (event.type) {
    case "app.created.v1":
      return { lifecycle: "active" satisfies Base44AppLifecycle };
    case "app.published.v1":
      return {
        publishedVersion: asString(data.published_version),
        publishedAt: asDate(data.published_at),
        unpublishedAt: null,
      };
    case "app.unpublished.v1":
      // publishedVersion is left in place on purpose: "what was last live" is
      // still the useful answer after an unpublish.
      return { unpublishedAt: asDate(data.unpublished_at) };
    case "app.deleted.v1":
      // Trash, not erasure — restorable for 30 days self-serve and longer
      // through support. Purging here would be wrong for every app that comes
      // back, which is what app.restored.v1 is for.
      return { lifecycle: "trashed" satisfies Base44AppLifecycle };
    case "app.restored.v1":
      return { lifecycle: "active" satisfies Base44AppLifecycle };
    default:
      return {};
  }
}

/**
 * Applies one verified event. Safe to call twice with the same event.
 *
 * The owner is resolved from the event's `owner_service_external_id`, never from
 * anything the request chose directly — and only because the signature already
 * verified, which is the only reason this field can be trusted to name whose
 * rows to touch.
 */
export async function projectEvent(event: CloudEvent): Promise<ProjectionOutcome> {
  if (!HANDLED.has(event.type)) return "ignored_unknown_type";

  const appId = asString(event.data.app_id);
  if (!appId) return "no_app_id";

  const occurredAt = asDate(event.time) ?? new Date();
  const existing = await prisma.base44AppState.findUnique({
    where: { appId },
    select: { lastEventAt: true, appName: true },
  });

  // Gated before anything is changed, not just before the state write: the
  // mirror deletes rows, and replaying a superseded deletion would take down an
  // app that is back.
  if (existing && existing.lastEventAt >= occurredAt) return "ignored_stale";

  const principal = asString(event.data.owner_service_external_id);
  const ownerEmail = principal ? await emailForServiceExternalId(principal) : null;

  // No resolved owner means no rows to change and nobody to tell — an app built
  // by another tool in the same workspace has a principal this shell never
  // provisioned. An ordinary answer, so the state is still recorded.
  const mirrored = ownerEmail
    ? await mirrorTransition({
        eventType: event.type,
        appId,
        ownerEmail,
        occurredAt,
        knownName: existing?.appName ?? null,
      })
    : {};

  const changes = { ...transition(event), ...mirrored };

  if (!existing) {
    await prisma.base44AppState.create({
      data: {
        appId,
        ownerEmail,
        lastEventAt: occurredAt,
        ...changes,
      } as Prisma.Base44AppStateCreateInput,
    });
    return "applied";
  }

  await prisma.base44AppState.update({
    where: { appId },
    data: {
      // Only overwrite a known owner: a later event whose principal we cannot
      // resolve should not erase the mapping an earlier one established.
      ...(ownerEmail ? { ownerEmail } : {}),
      lastEventAt: occurredAt,
      ...changes,
    },
  });
  return "applied";
}

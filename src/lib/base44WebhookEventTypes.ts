/**
 * The Base44 app lifecycle event types this receiver handles.
 *
 * Its own module, with no imports, for one reason: both the projection and
 * `scripts/webhook-register.ts` need this list, and the projection reaches the
 * database. A register script that imported it from there would need
 * `DATABASE_URL` configured in order to talk to Base44 — a coupling with nothing
 * behind it.
 *
 * Naming a type at registration that is missing here is legal and inert: Base44
 * delivers it, the receiver answers 2xx, nothing happens. That is deliberately
 * not an error — see `projectEvent`, which accepts an unknown type rather than
 * rejecting it, because a 4xx would put the endpoint on the retry ladder for
 * something this deployment will never accept, and enough consecutive failures
 * auto-pause it.
 */
export const HANDLED_EVENT_TYPES = [
  "app.created.v1",
  "app.published.v1",
  "app.unpublished.v1",
  "app.deleted.v1",
  "app.restored.v1",
] as const;

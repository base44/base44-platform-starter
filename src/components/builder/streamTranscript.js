/**
 * Turns a `message.updated` frame into a transcript row, so a streaming build
 * costs no HTTP at all.
 *
 * The stream carries the whole message on every tick — the platform flushes a
 * snapshot, not a delta — so re-reading `getConversation` to learn what it just
 * told us was a request per second for data already in hand.
 *
 * It cannot be used raw, though, and the failure would be quiet: the published
 * projection is deliberately narrower than the REST shape this app renders, and
 * three fields are named differently. `widgetFor` routes interrupts on
 * `waiting_on.kind`, which arrives flattened as `waiting_on_kind` — so passing
 * the frame straight through would render text correctly and stop rendering
 * approval, secrets and clarifying-question widgets entirely.
 *
 * `results` is the one field with no equivalent: the platform withholds it
 * unconditionally, because that is where app source and raw tool output land. So
 * a row's results arrive with the `getConversation` at the end of the turn, and
 * `mergeStreamedMessage` protects any already read from being blanked by a later
 * snapshot.
 */

/** One tool call, from the published projection to the shape the rows render. */
function toolCallFromStream(call) {
  return {
    id: call.id,
    name: call.name,
    status: call.status,
    requires_user_input: call.requires_user_input,
    // Published for interrupts specifically — a partner cannot answer a question
    // it cannot render. Empty when the tool's projection hides its details.
    arguments_string: call.arguments || "",
    // Re-nested: `widgetFor` reads `waiting_on.kind`, and null for a plain tool
    // call is what makes it fall through to the generic row.
    waiting_on: call.waiting_on_kind ? { kind: call.waiting_on_kind } : null,
    display_projection: call.display ?? null,
  };
}

/** A `message.updated` payload as a transcript row. */
export function messageFromStream(data) {
  if (!data?.message_id) return null;
  return {
    id: data.message_id,
    role: data.role,
    content: data.content || "",
    tool_calls: Array.isArray(data.tool_calls) ? data.tool_calls.map(toolCallFromStream) : [],
  };
}

/**
 * Last-write-wins per message id, appending one not seen before.
 *
 * Snapshots replace rather than accumulate, with one exception: a tool call's
 * `results` are never in a snapshot, so a row that already has them keeps them.
 * Without that, the tick after a tool completed would blank output the user was
 * looking at.
 */
export function mergeStreamedMessage(messages, incoming) {
  if (!incoming) return messages;
  const at = messages.findIndex((m) => m.id === incoming.id);
  if (at === -1) return [...messages, incoming];

  const held = messages[at];
  const heldCalls = held.tool_calls || [];
  const merged = {
    ...incoming,
    tool_calls: (incoming.tool_calls || []).map((call) => {
      const previous = heldCalls.find((h) => h.id === call.id);
      return previous?.results && !call.results
        ? { ...call, results: previous.results }
        : call;
    }),
  };

  const next = [...messages];
  next[at] = merged;
  return next;
}

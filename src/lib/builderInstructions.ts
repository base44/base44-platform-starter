/**
 * Custom instructions attached to every app the builder creates.
 *
 * Rides on the Base44 app's `custom_instructions` field: set at create time,
 * applied by the builder on **every** turn. `createApp` puts it in the POST
 * /api/apps body rather than patching it afterwards, because `initial_message`
 * starts the first build in that same call.
 *
 * Every turn pays for this text, so it stays a router. The actual API and data
 * model live in a Base44 **skill** — a document the builder loads on demand —
 * named below. Keep SKILL_NAME in sync with that skill's frontmatter `name`; the
 * text of ours is in docs/sunny-platform-skill.md.
 */

const SKILL_NAME = "sunny-platform";

/** A function only so call sites read as "build this now" — nothing is runtime-dependent. */
export function buildCustomInstructions(): string {
  return `# Built inside Sunny

Sunny is a work-management platform: boards hold groups of items (tasks) in
columns. This app was generated from inside Sunny to extend it — assume it
serves the user's work there.

Runtime: embedded in a sandboxed iframe (\`allow-scripts allow-same-origin
allow-forms allow-popups\`). As a dashboard widget it is user-resizable — 320px
tall and half-column by default — and full-height on "My Tools". So design for a
short, narrow viewport that scales up; no top-level navigation, downloads, or
full-screen. Report your content height so the card fits it instead of leaving
dead white space: \`parent.postMessage({ type: "sunny:size", height }, "*")\` on
mount and whenever it changes (the skill has the snippet). public_without_login — build no sign-in UI of your own. The Sunny
data you read is still per-user: Sunny hands this app a token for whoever is
viewing it, and every call needs one (the skill has the handshake). So never
cache a token or a row set across viewers. Visually: flat, neutral, small text,
rounded (not pill) corners, restrained accent color.

## Load the \`${SKILL_NAME}\` skill first

Sunny's data is not in this app's entities — it is a different service,
reachable only over HTTP. The endpoint, all actions, the Board/Item/Widget
schemas and the gotchas are in the **\`${SKILL_NAME}\`** skill.

Read it before writing code whenever the request mentions Sunny, the platform,
the workspace, board(s), group(s), item(s), task(s), row(s), column(s), status,
priority, due date, people, budget, widget(s), dashboard, "My Tools" — or asks
to read, write, sync, import, export, summarize or chart the user's real work
data. Indicative, not exhaustive: if it plausibly touches their boards, load it.

Cannot load it? Say so and ask. Guessing the API yields an app whose every
request is a 401, and no amount of retrying fixes it.`;
}

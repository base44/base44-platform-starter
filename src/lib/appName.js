// Names a new app from its first builder prompt.
//
// Base44's `createApp` takes an optional `name` alongside the prompt; without one
// the app is "Untitled". The prompt is a request ("build me a CRM for gyms"), not
// a title, so this trims the request wording off the front and title-cases what
// is left. Purely local, so app creation is never blocked on the naming step.

const MAX_LEN = 40;

/**
 * Words that describe the *request* rather than the thing requested. Stripped
 * one token at a time off the front, so any ordering of them is handled —
 * "please can you build me a simple app that…" and "i need a tool for…" both
 * reduce to the same remainder.
 */
const LEAD_IN_WORDS = new Set([
  "please",
  "can",
  "could",
  "you",
  "i",
  "we",
  "want",
  "wants",
  "need",
  "needs",
  "like",
  "to",
  "build",
  "create",
  "make",
  "generate",
  "design",
  "develop",
  "set",
  "up",
  "me",
  "us",
  "my",
  "a",
  "an",
  "the",
  "that",
  "which",
  "for",
  "some",
  "kind",
  "of",
  "app",
  "application",
  "tool",
  "website",
  "site",
  "webapp",
  "thing",
  "something",
  "simple",
  "small",
  "basic",
  "new",
  "dashboard",
  "page",
  "system",
  "platform",
]);

/** Verbs left dangling once the lead-in is gone: "that *tracks* my plants". */
const DANGLING_VERB =
  /^(?:tracks?|shows?|manages?|lets?|helps?|handles?|displays?|allows?|stores?|records?|lists?)$/i;

/** Connectors that must not be the last word of a name. */
const TRAILING_WORDS = new Set([
  "of",
  "for",
  "with",
  "and",
  "or",
  "to",
  "by",
  "in",
  "on",
  "at",
  "from",
  "the",
  "a",
  "an",
  "that",
  "which",
  "my",
  "their",
]);

/** Beyond this the name stops being a name — the prompt is right there anyway. */
const MAX_WORDS = 5;

/** Title-case only all-lowercase words, so "CRM" and "iOS" survive intact. */
const titleCase = (text) =>
  text.replace(/\b[a-z][a-z']*\b/g, (w) => w[0].toUpperCase() + w.slice(1));

/** Truncates on a word boundary — "Gym CRM With A Sa…" reads worse than "Gym CRM". */
function clamp(text, max = MAX_LEN) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * First clause, minus the request lead-in, title-cased.
 * "build me a CRM for gyms, with a pipeline" → "CRM For Gyms".
 */
export function suggestAppName(prompt) {
  const firstClause = prompt
    .trim()
    .split(/[.,;:\n!?]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const words = firstClause.split(" ").filter(Boolean);

  // One loop over both sets, so any interleaving works: "…a dashboard that
  // shows sales by region" strips down to "sales by region".
  let start = 0;
  while (
    start < words.length &&
    (LEAD_IN_WORDS.has(words[start].toLowerCase()) || DANGLING_VERB.test(words[start]))
  ) {
    start += 1;
  }

  // Stripping everything means the prompt was all lead-in — keep it as written.
  const kept =
    start < words.length ? words.slice(start, start + MAX_WORDS) : words.slice(0, MAX_WORDS);

  // The word cap can cut mid-phrase, leaving "…Description Of" hanging.
  while (kept.length > 1 && TRAILING_WORDS.has(kept[kept.length - 1].toLowerCase())) kept.pop();

  return clamp(titleCase(kept.join(" "))) || "Untitled App";
}

# Tiny Sunny

This example is read by developers who just read the
[white label docs](https://docs.base44.com/developers/white-label/overview), and its snippets go
into integration guides. Write it the way a careful developer would write a guide.

- **One Base44 call, one function.** Each function shows its request in the open: path, method,
  body. A reader should be able to paste it into a guide as it is.
- **Name things after the docs.** Use the step and field names the docs use.
- **Plain control flow.** `if` statements on one clear state, not chained ternaries or clever helpers.
  Prefer a few obvious lines over one dense line.
- **Guard only what matters.** Keep the token on the server, check app ownership, filter what goes to
  the browser, keep `X-Request-ID` stable. Skip checks for states that cannot happen.
- **Comments say why, briefly.** No comment that repeats the code.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

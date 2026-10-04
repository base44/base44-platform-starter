import { Base44Error } from "../base44/error";
import type { AppClient } from "../types";

type Body = ReturnType<typeof bodyReader>;

// The browser may call only these actions. Each one validates and returns the
// arguments for the AppClient method of the same name.
const actions: Record<string, (body: Body) => unknown[]> = {
  openBuilderSession: (b) => [b.id("appId")],
  listApps: (b) => [b.skip()],
  createApp: (b) => [b.text("prompt")],
  removeApp: (b) => [b.id("appId")],
  getApp: (b) => [b.id("appId")],
  sendMessage: (b) => [b.id("appId"), b.text("content")],
  submitToolCallInput: (b) => [{
    appId: b.id("appId"),
    toolCallId: b.id("toolCallId"),
    messageId: b.id("messageId"),
    approve: b.boolean("approve"),
    extraUserInput: b.object("extraUserInput"),
  }],
  getPreviewUrl: (b) => [b.id("appId")],
  deployApp: (b) => [b.id("appId")],
  getPublishedUrl: (b) => [b.id("appId")],
};

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

export function createHandler(resolveClient: () => Promise<AppClient>) {
  return async function POST(request: Request) {
    // After dispatch, a failure may still have changed something upstream.
    let dispatched = false;
    try {
      checkOrigin(request);
      const client = await resolveClient();
      const json = await readJson(request);
      if (json.appId !== undefined) await client.authorize(validId(json.appId, "appId"));

      const name = String(json.action);
      if (!Object.hasOwn(actions, name)) fail("Unsupported action.");
      const body = bodyReader(json);
      const args = actions[name](body);
      if (body.hasUnreadFields()) fail("Unexpected request field.");

      dispatched = true;
      const method = client[name as keyof AppClient] as (...args: unknown[]) => Promise<unknown>;
      return Response.json(await method(...args), { headers });
    } catch (error) {
      if (!(error instanceof Base44Error)) console.error("[api/base44]", error);
      const safe = error instanceof Base44Error
        ? error
        : new Base44Error("The local request failed. Check configuration and refresh app state.");
      return Response.json(
        { error: safe.message, outcome: dispatched ? "unknown" : "not_started" },
        { status: safe.status, headers },
      );
    }
  };
}

function fail(message: string, status = 400): never {
  throw new Base44Error(message, status);
}

// Only Tiny's own pages may call this: BUILDER_ORIGIN when hosted, a loopback
// host locally. (A DNS-rebinding page would send its own name as Host, so any
// other host is refused.) request.url is not used because Next rewrites it.
function checkOrigin(request: Request) {
  const host = request.headers.get("host") ?? "";
  const allowed = process.env.BUILDER_ORIGIN ||
    (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ? `http://${host}` : null);
  if (!allowed || request.headers.get("origin") !== allowed) fail("This request origin is not allowed.", 403);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    fail("Send application/json.", 415);
  const text = await request.text();
  if (text.length > 64_000) fail("Request body is too large.", 413);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    fail("Invalid JSON.");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) fail("Expected a JSON object.");
  return json;
}

function validId(value: unknown, key: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail(`Invalid ${key}.`);
  return value;
}

// Validates fields by name and remembers which ones were read, so any extra
// field in the request is rejected.
function bodyReader(json: Record<string, unknown>) {
  const read = new Set(["action"]);
  const get = (key: string) => (read.add(key), json[key]);
  return {
    id: (key: string) => validId(get(key), key),
    text(key: string) {
      const value = get(key);
      if (typeof value !== "string" || !value.trim() || value.length > 16_000) fail(`Invalid ${key}.`);
      return value;
    },
    skip() {
      const value = get("skip") ?? 0;
      if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100_000) fail("Invalid skip.");
      return value as number;
    },
    boolean(key: string) {
      const value = get(key);
      if (typeof value !== "boolean") fail(`Invalid ${key}.`);
      return value;
    },
    object(key: string) {
      const value = get(key);
      if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Invalid ${key}.`);
      return value as Record<string, unknown>;
    },
    hasUnreadFields: () => Object.keys(json).some((key) => !read.has(key)),
  };
}

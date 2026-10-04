import { Base44Error } from "../base44/error";
import type { AppClient } from "../types";

type Body = Record<string, unknown>;

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

// The one endpoint Tiny's browser code calls. Every request is checked here
// before anything reaches Base44.
export function createHandler(getClient: () => Promise<AppClient>) {
  return async function POST(request: Request) {
    try {
      checkOrigin(request);
      const client = await getClient();
      const body = await readBody(request);

      // Base44 cannot tell builders apart, so this is where they are kept apart:
      // an app ID must belong to the signed-in builder.
      if (body.appId !== undefined) {
        await client.authorize(checkId(body.appId, "appId"));
      }

      const result = await run(client, body);
      return Response.json(result, { headers });
    } catch (error) {
      if (error instanceof Base44Error) {
        return Response.json({ error: error.message }, { status: error.status, headers });
      }
      console.error("[api/base44]", error);
      return Response.json({ error: "The request failed. Check the server configuration." }, { status: 502, headers });
    }
  };
}

// The actions the browser may ask for. Each accepts only its own fields.
function run(client: AppClient, body: Body) {
  switch (body.action) {
    case "listApps":
      onlyFields(body, "skip");
      return client.listApps(checkSkip(body.skip));

    case "createApp":
      onlyFields(body, "prompt");
      return client.createApp(checkText(body.prompt, "prompt"));

    case "sendMessage":
      onlyFields(body, "appId", "content");
      return client.sendMessage(checkId(body.appId, "appId"), checkText(body.content, "content"));

    case "submitToolCallInput":
      onlyFields(body, "appId", "toolCallId", "messageId", "approve", "extraUserInput");
      if (typeof body.approve !== "boolean") fail("Invalid approve.");
      if (!isObject(body.extraUserInput)) fail("Invalid extraUserInput.");
      return client.submitToolCallInput({
        appId: checkId(body.appId, "appId"),
        toolCallId: checkId(body.toolCallId, "toolCallId"),
        messageId: checkId(body.messageId, "messageId"),
        approve: body.approve,
        extraUserInput: body.extraUserInput,
      });

    case "getApp":
      onlyFields(body, "appId");
      return client.getApp(checkId(body.appId, "appId"));

    case "getPreviewUrl":
      onlyFields(body, "appId");
      return client.getPreviewUrl(checkId(body.appId, "appId"));

    case "getLatestBuildUrl":
      onlyFields(body, "appId");
      return client.getLatestBuildUrl(checkId(body.appId, "appId"));

    case "openLiveUpdates":
      onlyFields(body, "appId");
      return client.openLiveUpdates(checkId(body.appId, "appId"));

    case "deployApp":
      onlyFields(body, "appId");
      return client.deployApp(checkId(body.appId, "appId"));

    case "getPublishedUrl":
      onlyFields(body, "appId");
      return client.getPublishedUrl(checkId(body.appId, "appId"));

    case "removeApp":
      onlyFields(body, "appId");
      return client.removeApp(checkId(body.appId, "appId"));

    default:
      fail("Unsupported action.");
  }
}

// Only Tiny's own pages may call this: BUILDER_ORIGIN when hosted, a loopback
// host when running locally. A DNS-rebinding page would send its own name as
// Host, so any other host is refused. request.url is not used: Next rewrites it.
function checkOrigin(request: Request) {
  const host = request.headers.get("host") ?? "";
  const origin = request.headers.get("origin");
  const isLocal = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);

  let allowed: string | null = null;
  if (process.env.BUILDER_ORIGIN) {
    allowed = process.env.BUILDER_ORIGIN;
  } else if (isLocal) {
    allowed = `http://${host}`;
  }
  if (!allowed || origin !== allowed) fail("This request origin is not allowed.", 403);
}

async function readBody(request: Request): Promise<Body> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    fail("Send application/json.", 415);
  }
  const text = await request.text();
  if (text.length > 64_000) fail("Request body is too large.", 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    fail("Invalid JSON.");
  }
  if (!isObject(body)) fail("Expected a JSON object.");
  return body;
}

function onlyFields(body: Body, ...allowed: string[]) {
  for (const key of Object.keys(body)) {
    if (key !== "action" && !allowed.includes(key)) fail("Unexpected request field.");
  }
}

function checkId(value: unknown, name: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail(`Invalid ${name}.`);
  return value;
}

function checkText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 16_000) fail(`Invalid ${name}.`);
  return value;
}

function checkSkip(value: unknown = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000) fail("Invalid skip.");
  return value;
}

function isObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, status = 400): never {
  throw new Base44Error(message, status);
}

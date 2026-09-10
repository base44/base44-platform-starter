import * as base44 from "./base44-server";
import type { WorkspaceClient } from "./workspace";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const bad = (message: string, status = 400): never => {
  throw new base44.Base44Error(message, status);
};

export function createHandler(resolveClient: () => Promise<WorkspaceClient>) {
  return async function POST(request: Request) {
    let dispatched = false;
    try {
      const host = request.headers.get("host");
      const origin = request.headers.get("origin");
      const hostedOrigin = process.env.BUILDER_ORIGIN;
      if (hostedOrigin) {
        const allowed = new URL(hostedOrigin);
        if (
          allowed.protocol !== "https:" ||
          allowed.origin !== hostedOrigin ||
          host !== allowed.host ||
          origin !== hostedOrigin
        )
          bad("This request origin is not allowed.", 403);
      } else if (
        !host ||
        !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
        origin !== `http://${host}`
      ) {
        bad("This request origin is not allowed.", 403);
      }
      const client = await resolveClient();
      if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
        bad("Send application/json.", 415);
      // Read a bounded stream instead of trusting Content-Length.
      const reader = request.body?.getReader();
      if (!reader) return bad("A JSON body is required.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64_000) {
          await reader.cancel();
          bad("Request body is too large.", 413);
        }
        chunks.push(value);
      }
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return Response.json(
          { error: "Invalid JSON.", outcome: "not_started" },
          { status: 400, headers },
        );
      }
      if (!p || typeof p !== "object" || Array.isArray(p)) bad("Expected a JSON object.");
      const fields = (...allowed: string[]) => {
        if (Object.keys(p).some((k) => !["action", ...allowed].includes(k)))
          bad("Unexpected request field.");
      };
      const string = (key: string, max = 16_000): string => {
        const v = p[key];
        if (typeof v !== "string" || !v.trim() || v.length > max) return bad(`Invalid ${key}.`);
        return v;
      };
      const id = (key: string) => {
        const v = string(key, 200);
        if (!/^[A-Za-z0-9_-]+$/.test(v)) bad(`Invalid ${key}.`);
        return v;
      };
      let result;
      if (p.appId !== undefined) await client.authorize(id("appId"));
      dispatched = true;
      switch (p.action) {
        case "listApps": {
          fields("skip");
          const skip = p.skip ?? 0;
          if (typeof skip !== "number" || !Number.isSafeInteger(skip) || skip < 0 || skip > 100_000)
            bad("Invalid skip.");
          result = await client.listApps(skip as number);
          break;
        }
        case "createApp":
          fields("prompt");
          result = await client.createApp(string("prompt"));
          break;
        case "getApp":
          fields("appId");
          result = await client.getApp(id("appId"));
          break;
        case "getConversation": {
          fields("appId", "skip");
          const skip = p.skip ?? 0;
          if (typeof skip !== "number" || !Number.isSafeInteger(skip) || skip < 0 || skip > 100_000)
            bad("Invalid skip.");
          result = await client.getConversation(id("appId"), skip as number);
          break;
        }
        case "sendMessage":
          fields("appId", "content");
          result = await client.sendMessage(id("appId"), string("content"));
          break;
        case "submitToolCallInput": {
          fields("appId", "toolCallId", "messageId", "approve", "extraUserInput");
          if (
            typeof p.approve !== "boolean" ||
            !p.extraUserInput ||
            typeof p.extraUserInput !== "object" ||
            Array.isArray(p.extraUserInput)
          )
            bad("Invalid tool-call decision or input.");
          result = await client.submitToolCallInput({
            appId: id("appId"),
            toolCallId: id("toolCallId"),
            messageId: id("messageId"),
            approve: p.approve as boolean,
            extraUserInput: p.extraUserInput as Record<string, unknown>,
          });
          break;
        }
        case "getPreviewUrl":
          fields("appId");
          result = await client.getPreviewUrl(id("appId"));
          break;
        case "deployApp":
          fields("appId");
          result = await client.deployApp(id("appId"));
          break;
        case "getPublishedUrl":
          fields("appId");
          result = await client.getPublishedUrl(id("appId"));
          break;
        default:
          bad("Unsupported action.");
      }
      return Response.json(result, { headers });
    } catch (error) {
      const safe =
        error instanceof base44.Base44Error
          ? error
          : new base44.Base44Error(
              "The local request failed. Check configuration and refresh app state.",
            );
      return Response.json(
        { error: safe.message, outcome: dispatched ? "unknown" : "not_started" },
        { status: safe.status, headers },
      );
    }
  };
}

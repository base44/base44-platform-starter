import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { connect, disconnect, getLink, getPlatformClient, linkStatus, principalId, remint, emailForServiceExternalId } from "../src/lib/base44Link";
import { runAppOperation } from "../src/lib/base44AppOperations";

test("starter persists SDK tokens, preserves browser shapes and shares credentials with chat", async (t) => {
  const env = { ...process.env };
  process.env.BASE44_SVC_KEY = "fixture-key";
  process.env.BASE44_ORG_ID = "workspace1";
  process.env.BASE44_PLATFORM_HOST = "https://platform.example";
  process.env.BASE44_APPS_FOLDER_ID = "folder1";
  t.after(() => { process.env = env; });
  const delegate = prisma.base44Link as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  function replace(name: string, fn: unknown) {
    originals.set(name, delegate[name]);
    delegate[name] = fn;
  }
  t.after(() => { for (const [name, fn] of originals) delegate[name] = fn; });
  const rows = new Map<string, Record<string, unknown>>();
  type Where = Record<string, unknown>;
  const matching = (where: Where) => [...rows.values()].filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  replace("findUnique", async ({ where }: { where: Where }) => matching(where)[0] ?? null);
  replace("upsert", async ({ where, create, update }: { where: Where; create: Where; update: Where }) => {
    const existing = matching(where)[0];
    const row = existing ? Object.assign(existing, update) : { accessToken: null, refreshToken: null, expiresAt: null, ...create };
    rows.set(String(row.appUserEmail), row);
    return row;
  });
  replace("updateMany", async ({ where, data }: { where: Where; data: Where }) => {
    const selected = matching(where);
    selected.forEach(row => Object.assign(row, data));
    return { count: selected.length };
  });
  replace("deleteMany", async ({ where }: { where: Where }) => {
    const selected = matching(where);
    selected.forEach(row => rows.delete(String(row.appUserEmail)));
    return { count: selected.length };
  });
  let failMint = false;
  let mints = 0;
  const calls: { path: string; method: string; authorization: string | null; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ path, method: init.method!, authorization: new Headers(init.headers).get("Authorization"), body });
    if (path === "/api/service/users") return Response.json({ service_external_id: body.service_external_id, user_id: "service1", email: "service@workspace1.svc.base44.invalid", role: "editor", created: true });
    if (path === "/api/service/user-tokens") {
      if (failMint) return Response.json({}, { status: 429 });
      mints++;
      return Response.json({ access_token: `access-${mints}`, refresh_token: "refresh", expires_in: 3600 });
    }
    if (path === "/oauth/revoke") return new Response(null, { status: 204 });
    if (path.includes("app-folders")) return new Response(null, { status: 204 });
    if (path.endsWith("preview-url")) return Response.json({ preview_url: "https://preview.example", preview_token: "preview" });
    if (path.endsWith("deploy")) return Response.json({ app_id: "app1", checkpoint_id: null, git_commit_hash: "commit1", deployed_at: "2026-01-01" });
    const app = { id: "app1", name: "Tracker", custom_instructions: "private instructions", owner_id: "private", pages: "private", status: { state: "ready", details: "private" } };
    return Response.json(init.method === "GET" && path === "/api/apps" ? [app] : app);
  });

  const status = await connect("CUSTOMER@example.com");
  assert.equal(status.linked, true);
  assert.equal(JSON.stringify(status).includes("access-"), false);
  assert.equal(await emailForServiceExternalId(principalId("customer@example.com")), "customer@example.com");
  const user = getPlatformClient().asUser(principalId("customer@example.com"));
  await connect("customer@example.com");
  assert.equal(mints, 1);
  for (const action of ["listApps", "getApp", "createApp", "renameApp"]) {
    const result = await runAppOperation(user, action, { appId: "app1", name: "Tracker", prompt: "Build", customInstructions: "Instructions" });
    assert.equal(JSON.stringify(result).includes("private"), false);
    const app = Array.isArray(result) ? result[0] : result;
    assert.ok("has_custom_instructions" in app);
    assert.equal(app.has_custom_instructions, true);
  }
  await runAppOperation(user, "fileAppsInFolder", { appIds: ["app1"] });
  assert.deepEqual(await runAppOperation(user, "getPreviewUrl", { appId: "app1" }), { preview_url: "https://preview.example", preview_token: "preview" });
  assert.deepEqual(await runAppOperation(user, "deployApp", { appId: "app1" }), { app_id: "app1", checkpoint_id: null, git_commit_hash: "commit1", deployed_at: "2026-01-01" });
  const creation = calls.find(c => c.path === "/api/apps" && c.method === "POST")!;
  assert.equal(creation.body.prevent_iframe_embedding, false);
  assert.equal(creation.body.public_settings, "public_without_login");
  assert.equal(creation.authorization, "Bearer access-1");
  assert.equal(mints, 1);

  const link = (await getLink("customer@example.com"))!;
  failMint = true;
  assert.equal(await remint(link), null);
  assert.equal(linkStatus(await getLink("customer@example.com")).linked, true);
  failMint = false;
  assert.equal((await remint(link))?.accessToken, "access-2");
  assert.equal(await user.getAccessToken(), "access-2");
  assert.deepEqual(await disconnect("customer@example.com"), { linked: false, base44_user_email: null, organization_id: null });
  assert.equal(rows.size, 0);
  assert.equal(calls.some(c => c.method === "DELETE" && c.path.includes("/service/users")), false);
  await assert.rejects(user.getAccessToken(), { code: "token_store_error" });
  assert.equal(rows.size, 0);
});

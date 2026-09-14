import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHash } from "node:crypto";
import { prisma } from "../lib/db";
import { connect, disconnect, getBase44AccessToken } from "../lib/base44-identity";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalTransaction = prisma.$transaction;
const originalMethods = {
  findUnique: prisma.base44Link.findUnique,
  upsert: prisma.base44Link.upsert,
  updateMany: prisma.base44Link.updateMany,
};
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  prisma.$transaction = originalTransaction;
  Object.assign(prisma.base44Link, originalMethods);
});

function setup(overrides = {}) {
  process.env.BASE44_PLATFORM_HOST = "https://base44.example";
  process.env.BASE44_ORG_ID = "workspace";
  process.env.BASE44_SVC_KEY = "workspace-key";
  let row: any = {
    appUserEmail: "builder@example.com", status: "linked", accessToken: "old-access",
    refreshToken: "old-refresh", expiresAt: new Date(0), serviceExternalId: "existing-id",
    ...overrides,
  };
  const calls: { url: string; init?: RequestInit }[] = [];
  const db = {
    $queryRaw: async () => [],
    base44Link: {
      findUnique: async () => row,
      update: async ({ data }: any) => (row = { ...row, ...data }),
    },
  };
  prisma.$transaction = (async (fn: any) => fn(db)) as any;
  prisma.base44Link.findUnique = db.base44Link.findUnique as any;
  prisma.base44Link.upsert = (async ({ update }: any) => (row = { ...row, ...update })) as any;
  prisma.base44Link.updateMany = (async ({ data }: any) => {
    row = { ...row, ...data }; return { count: 1 };
  }) as any;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith("/api/service/users")
      ? { email: "builder@workspace.svc.base44.invalid" }
      : { access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
  };
  return { calls, row: () => row };
}

test("connect provisions then mints with workspace credentials and preserves the stored identity", async () => {
  const state = setup();
  const result = await connect("BUILDER@example.com");
  assert.deepEqual(state.calls.map(c => new URL(c.url).pathname), ["/api/service/users", "/api/service/user-tokens"]);
  for (const call of state.calls) {
    assert.equal(new Headers(call.init?.headers).get("Authorization"), "workspace-key");
    assert.equal(JSON.parse(String(call.init?.body)).service_external_id, "existing-id");
  }
  assert.equal(result.linked, true);
  assert.equal(JSON.stringify(result).includes("new-access"), false);
});

test("new identities retain the deterministic ID used by existing apps", async () => {
  const state = setup({ serviceExternalId: null });
  await connect("BUILDER@example.com");
  const digest = createHash("sha256").update("workspace:builder@example.com").digest("hex");
  assert.equal(state.row().serviceExternalId, `sunny-${digest.slice(0, 32)}`);
});

test("unexpired tokens are reused without an upstream request", async () => {
  const state = setup({ expiresAt: new Date(Date.now() + 120_000) });
  assert.equal(await getBase44AccessToken("builder@example.com"), "old-access");
  assert.equal(state.calls.length, 0);
});

test("refresh uses the OAuth exchange and persists rotated credentials and lifetime", async () => {
  const state = setup();
  assert.equal(await getBase44AccessToken("builder@example.com"), "new-access");
  assert.equal(state.calls[0].url, "https://base44.example/oauth/token");
  assert.equal(new Headers(state.calls[0].init?.headers).has("Authorization"), false);
  assert.equal(String(state.calls[0].init?.body), "grant_type=refresh_token&client_id=svc_delegate&refresh_token=old-refresh");
  assert.equal(state.row().refreshToken, "new-refresh");
  assert.ok(state.row().expiresAt.getTime() > Date.now() + 3500_000);
});

test("refresh failures preserve stored credentials and never expose upstream bodies", async () => {
  const state = setup();
  for (const status of [400, 429, 503]) {
    globalThis.fetch = async () => new Response("secret-canary", { status });
    await assert.rejects(getBase44AccessToken("builder@example.com"), (error: any) => {
      assert.equal(error.status, status === 400 ? 428 : 502);
      assert.equal(error.message.includes("secret-canary"), false);
      return true;
    });
    assert.equal(state.row().refreshToken, "old-refresh");
  }
});

test("disconnect clears tokens but retains identity mapping", async () => {
  const state = setup();
  await disconnect("builder@example.com");
  assert.equal(state.row().serviceExternalId, "existing-id");
  assert.equal(state.row().accessToken, null);
  assert.equal(state.row().refreshToken, null);
  assert.equal(state.row().status, "pending");
});

/**
 * Smoke test for the build-session push channel.
 *
 * The same posture as `base44-smoke.ts`: this asserts the **boundary**, not the
 * happy path. A real turn spends a real workspace's credits, so it is a manual
 * step (see the bottom of this file for the one-liner).
 *
 * What it pins down:
 *   1. all four trigger actions need a session, like every other action
 *   2. the allow-list actually covers them — a dirty app id never reaches a path
 *   3. required params are validated *before* any upstream call, including the
 *      `decision` enum, and `respond` is refused outright without a waitpoint
 *   4. `decision` is the wire name for `respond`'s action, because the proxy
 *      spends the top-level `action` key on which op to run — if this ever
 *      regresses to `action`, the value is destructured away and the upstream
 *      call goes out with `action: undefined`
 *   5. a respond's request id is stable per waitpoint, so a retried POST dedupes
 *      instead of resuming and charging the turn twice — while a *send* gets a
 *      fresh key every time, because a key derived from the message would make
 *      the same text sent twice a silent no-op
 *   6. a streamed message becomes a transcript row with the field names the
 *      rows actually render — the published projection renames three of them,
 *      and getting `waiting_on` wrong breaks every interrupt widget silently
 *   7. an unlinked user gets 428 `not_linked`, and a deployment with no
 *      `BASE44_SVC_KEY` gets 501 `bridge_misconfigured` — never a crash, and
 *      never a response that names an environment variable
 *
 * Needs `npm run dev`. Writes throwaway rows to DATABASE_URL and cleans up:
 *   npm run session:smoke
 */

import { encode } from "next-auth/jwt";

import { newSendKey, submitRequestId } from "../src/lib/base44Platform";
import {
  mergeStreamedMessage,
  messageFromStream,
} from "../src/components/builder/streamTranscript";
import { prisma } from "../src/lib/prisma";

const TAG = "b44-session-smoke";
const USER = `${TAG}-user@example.com`;

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const CONFIGURED = Boolean(process.env.BASE44_SVC_KEY);

let failures = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Res = { status: number; body: Record<string, unknown> };

let cookie = "";

async function platform(body: unknown, authed = true): Promise<Res> {
  const res = await fetch(`${BASE_URL}/api/base44/platform`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authed ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const ACTIONS = [
  "mintBuildSessionToken",
  "sendBuildSessionMessage",
  "respondToBuildSession",
  "cancelBuildSessionTurn",
  "revokeBuildSessionGrant",
];

/** Params that make each action *valid*, so a 400 can only be about the app id. */
const VALID: Record<string, Record<string, unknown>> = {
  mintBuildSessionToken: {},
  sendBuildSessionMessage: { content: "hello" },
  respondToBuildSession: { waitpointId: "toolu_1", kind: "approval", decision: "approved" },
  cancelBuildSessionTurn: {},
  revokeBuildSessionGrant: { grantId: "gr4nt1d" },
};

async function cleanup() {
  await prisma.base44Link.deleteMany({ where: { appUserEmail: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

async function main() {
  try {
    const ping = await fetch(`${BASE_URL}/api/auth/providers`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!ping.ok) throw new Error(String(ping.status));
  } catch {
    console.error(`\nNo dev server at ${BASE_URL}. Start it with \`npm run dev\` and re-run.`);
    process.exitCode = 1;
    return;
  }

  await cleanup();
  await prisma.user.create({ data: { email: USER } });
  const jwt = await encode({
    token: { email: USER, role: "user", roleCheckedAt: Date.now() },
    secret: process.env.NEXTAUTH_SECRET!,
  });
  cookie = `next-auth.session-token=${jwt}`;

  console.log("\n1. the boundary: a session is required");

  for (const action of ACTIONS) {
    const res = await platform({ action, appId: "app1", ...VALID[action] }, false);
    check(`anonymous ${action} is 401`, res.status === 401, `got ${res.status}`);
  }

  console.log("\n2. the allow-list validates before it calls out");

  for (const action of ACTIONS) {
    // A slash would escape the allow-listed path shape entirely.
    const res = await platform({ action, appId: "app/../../evil", ...VALID[action] });
    check(`${action} rejects a dirty appId`, res.status === 400, `got ${res.status}`);
  }

  const noContent = await platform({ action: "sendBuildSessionMessage", appId: "app1" });
  check("sendBuildSessionMessage needs content", noContent.status === 400);

  const noWaitpoint = await platform({
    action: "respondToBuildSession",
    appId: "app1",
    decision: "approved",
  });
  check("respondToBuildSession needs a waitpointId", noWaitpoint.status === 400);

  const badDecision = await platform({
    action: "respondToBuildSession",
    appId: "app1",
    waitpointId: "toolu_1",
    kind: "approval",
    decision: "maybe",
  });
  check("respondToBuildSession rejects an unknown decision", badDecision.status === 400);

  const badKind = await platform({
    action: "respondToBuildSession",
    appId: "app1",
    waitpointId: "toolu_1",
    kind: "quota",
    decision: "approved",
  });
  check("respondToBuildSession rejects a kind that is not answerable", badKind.status === 400);
  check(
    "and names quota's absence rather than accepting it",
    String(badKind.body.detail ?? "").includes("kind"),
    JSON.stringify(badKind.body),
  );
  check(
    "the rejection names the field the caller must fix",
    // jsonError puts the code in `error` and the human message in `detail`;
    // the not_linked checks below read `code` because errorResponse uses the
    // other shape. Two shapes, both pre-existing — assert against the right one.
    String(badDecision.body.detail ?? "").includes("decision"),
    JSON.stringify(badDecision.body),
  );

  // The regression this guards: if the wire name goes back to `action`, the
  // proxy's own destructuring eats it and validation can no longer see it — so
  // the call would sail past this check instead of failing here.
  const collidingName = await platform({
    action: "respondToBuildSession",
    appId: "app1",
    waitpointId: "toolu_1",
    // deliberately NOT `decision`
  });
  check(
    "an answer sent under any other name is refused, not silently dropped",
    collidingName.status === 400,
    `got ${collidingName.status}`,
  );

  const dirtyGrant = await platform({
    action: "revokeBuildSessionGrant",
    appId: "app1",
    grantId: "../../evil",
  });
  check("revokeBuildSessionGrant rejects a dirty grantId", dirtyGrant.status === 400);

  console.log("\n3. a send names a NEW turn; an answer names the one it answers");

  // The regression this guards is silent in production and expensive: a key
  // derived from the message makes the platform read a second identical send as
  // a network retry and drop the turn behind a 202, for the ten minutes it holds
  // the claim. Two sends must never collide, and the key must not be the message.
  check("two sends never share a key", newSendKey() !== newSendKey());
  check(
    "and a send's key is an opaque id, not the message text",
    /^send-[0-9a-f-]{36}$/.test(newSendKey()),
    newSendKey(),
  );

  check(
    "a respond's request id is stable per waitpoint",
    submitRequestId("toolu_abc") === submitRequestId("toolu_abc"),
  );
  check(
    "and distinct per waitpoint",
    submitRequestId("toolu_abc") !== submitRequestId("toolu_def"),
  );

  console.log("\n4. a streamed frame is a transcript row");

  // A real `message.updated` payload, mid-sentence, as the platform sends it.
  const textFrame = {
    message_id: "435a5bcf-41eb-4a01-b3f8-b0574e2587b4",
    role: "assistant",
    content: "Now I have the Sunny platform details. Let me build",
    tool_calls: [],
  };
  const textRow = messageFromStream(textFrame);
  check("`message_id` becomes `id`, which is what the rows key on", textRow?.id === textFrame.message_id);
  check("role and content carry through", textRow?.role === "assistant" && textRow?.content === textFrame.content);

  // The regression that would be silent: `widgetFor` routes on
  // `waiting_on.kind`, and the platform publishes it flattened as
  // `waiting_on_kind`. Pass the frame through raw and text still renders while
  // every approval, secrets and clarifying-question widget quietly stops.
  const interruptFrame = {
    message_id: "m2",
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "toolu_1",
        name: "ask_user_approval",
        status: "waiting_for_user_input",
        requires_user_input: true,
        waiting_on_kind: "approval",
        arguments: '{"packages":["left-pad"]}',
        display: null,
      },
    ],
  };
  const interruptRow = messageFromStream(interruptFrame);
  const call = interruptRow?.tool_calls?.[0];
  check("`waiting_on_kind` is re-nested as `waiting_on.kind`", call?.waiting_on?.kind === "approval");
  check("`arguments` becomes `arguments_string`", call?.arguments_string === '{"packages":["left-pad"]}');
  check("...and it parses, so a widget can render the question", JSON.parse(call?.arguments_string ?? "null")?.packages?.[0] === "left-pad");

  // A plain tool call must fall through to the generic row, not to a widget.
  const plain = messageFromStream({
    message_id: "m3",
    role: "assistant",
    content: "",
    tool_calls: [{ id: "t2", name: "write_file", status: "running", arguments: "{}" }],
  });
  check("a tool call with no waiting kind gets no `waiting_on`", plain?.tool_calls?.[0]?.waiting_on === null);

  check("a frame with no message_id is not a row", messageFromStream({ role: "assistant" }) === null);

  // Snapshots replace; they never accumulate.
  const first = messageFromStream({ ...textFrame, content: "Now I" })!;
  const second = messageFromStream({ ...textFrame, content: "Now I have the details" })!;
  let held = mergeStreamedMessage([], first);
  held = mergeStreamedMessage(held, second);
  check("a second snapshot replaces the first rather than appending", held.length === 1);
  check("...and the newer text wins", held[0].content === "Now I have the details");
  check("a different id appends", mergeStreamedMessage(held, messageFromStream({ ...textFrame, message_id: "other" })!).length === 2);

  // `results` are never streamed, so a snapshot must not blank ones already read.
  const withResults = [
    {
      id: "m2",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "toolu_1", name: "write_file", status: "success", results: "wrote 3 files" }],
    },
  ];
  const afterSnapshot = mergeStreamedMessage(withResults, messageFromStream({
    message_id: "m2",
    role: "assistant",
    content: "",
    tool_calls: [{ id: "toolu_1", name: "write_file", status: "success", arguments: "{}" }],
  })!);
  check(
    "a snapshot does not blank tool results already read",
    afterSnapshot[0].tool_calls[0].results === "wrote 3 files",
  );

  console.log("\n5. an unlinked user is told to connect, not crashed");

  for (const action of ACTIONS) {
    const res = await platform({ action, appId: "app1", ...VALID[action] });
    const expected = CONFIGURED ? 428 : 501;
    const code = CONFIGURED ? "not_linked" : "bridge_misconfigured";
    check(
      `${action} answers ${expected} ${code}`,
      res.status === expected && res.body.code === code,
      `got ${res.status} ${JSON.stringify(res.body.code)}`,
    );
  }

  check(
    "and says nothing about the environment",
    !JSON.stringify(
      await platform({ action: "mintBuildSessionToken", appId: "app1" }),
    ).includes("BASE44_"),
  );

  await cleanup();

  console.log(
    failures === 0
      ? "\n✔ build-session boundary holds\n"
      : `\n✘ ${failures} check(s) failed\n`,
  );
  if (failures > 0) process.exitCode = 1;

  // Not automated, because it spends real credits against a real workspace:
  //
  //   1. NEXT_PUBLIC_BASE44_BUILD_SESSIONS=1, and confirm `base44-for-platforms`
  //      is enabled for BASE44_ORG_ID — otherwise every call 404s.
  //   2. Build an app from the sidebar. In the network panel there should be one
  //      EventSource, no 2.5s poll loop, and — while the build streams — no
  //      `getApp`/`getConversation` calls at all: the transcript comes off the
  //      stream. Exactly one pair should land when the turn finishes. The send
  //      should answer in milliseconds rather than tens of seconds.
  //   3. Check the EventSource URL is on the Base44 host, not this app's. The
  //      proxy absolutizes `stream_url` server-side; a relative one would point
  //      `EventSource` back here, and a caller-supplied one would be an SSRF.
  //   4. Prompt something that asks a clarifying question, and confirm the
  //      widget renders and /respond resumes the turn.
  //   5. Press Stop mid-build.
  //   6. Send the *same* message twice. Both turns must run — the second being
  //      swallowed behind a 202 is the content-derived-key bug returning.
  //   7. Restore a checkpoint on the app from the Base44 editor while the
  //      sidebar is open: the transcript must re-read itself (conversation.reset)
  //      rather than sit there disagreeing with the server.
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

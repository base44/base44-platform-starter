/**
 * POST /api/base44/app-notices — hands the signed-in user any Base44 app
 * transition they have not been told about.
 *
 * A deletion happens on Base44's side while nobody is looking, so telling its
 * owner has to survive until they next open the shell. There is no push channel
 * here: the notice waits on the app's state row and the browser polls for it
 * (src/components/AppNotices.tsx).
 *
 * **POST rather than GET, because reading a notice consumes it.** The read and
 * the clear are one compare-and-swap, so a GET would be a cacheable mutation and
 * every open tab would announce every notice.
 *
 * Scoped to the session user by `claimNotices`. This route never takes an app id
 * or an email from the request — there is nothing here a caller could point at
 * somebody else's apps.
 */

import { NextResponse } from "next/server";

import { claimNotices } from "@/lib/base44AppMirror";
import { errorResponse } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";

export async function POST() {
  try {
    const actor = await requireSessionUser();
    return NextResponse.json({ notices: await claimNotices(actor) });
  } catch (err) {
    return errorResponse(err);
  }
}

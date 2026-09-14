import { requireUser } from "../../../../lib/server/auth";
import { connect, disconnect, getLink, linkStatus } from "../../../../lib/base44/identity";
import { Base44Error } from "../../../../lib/base44/error";

const headers = { "Cache-Control": "no-store, private" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = process.env.BUILDER_ORIGIN || new URL(request.url).origin;
  if (origin !== allowed)
    return Response.json(
      { error: "This request origin is not allowed." },
      { status: 403, headers },
    );
  try {
    const actor = await requireUser();
    const payload = await request.json().catch(() => null);
    let result;
    switch (payload?.action) {
      case "status":
        result = linkStatus(await getLink(actor.email));
        break;
      case "connect":
        result = await connect(actor.email);
        break;
      case "disconnect":
        result = await disconnect(actor.email);
        break;
      default:
        return Response.json({ error: "Invalid connection action." }, { status: 400, headers });
    }
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof Base44Error)
      return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json(
      { error: "Could not update your Base44 connection." },
      { status: 500, headers },
    );
  }
}

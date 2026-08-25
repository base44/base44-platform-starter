/**
 * /api/entities/[entity] — list + create, the replacement for Base44's auto-REST
 * (`GET|POST /entities/E`).
 *
 * `entity` is resolved through the allowlist in src/lib/entities.ts, which is
 * exactly `USER_OWNED_MODELS`: `Base44Link` is not reachable here (gotcha 3) and
 * `User` lives at /api/me.
 *
 * Not implemented, because nothing calls them: `DELETE /entities/E` (Base44 deletes ALL
 * rows on an empty body — a footgun with no call site) and `PATCH /update-many`.
 */

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseBody,
  parseCount,
  parseFilter,
  parseSort,
  resolveEntity,
} from "@/lib/entities";
import { createEntity, listEntities } from "@/lib/entityCrud";

type Ctx = { params: Promise<{ entity: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const model = resolveEntity((await params).entity);
    if (!model) return jsonError(404, "unknown_entity");

    const actor = await requireSessionUser();
    const q = req.nextUrl.searchParams;

    const rows = await listEntities(model, actor, {
      where: parseFilter(model, q.get("q")),
      orderBy: parseSort(model, q.get("sort_by")),
      take: parseCount(q.get("limit"), DEFAULT_LIMIT, MAX_LIMIT),
      skip: parseCount(q.get("skip"), 0, Number.MAX_SAFE_INTEGER),
    });

    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const model = resolveEntity((await params).entity);
    if (!model) return jsonError(404, "unknown_entity");

    const actor = await requireSessionUser();
    const data = parseBody(model, await req.json(), "create");

    return NextResponse.json(await createEntity(model, actor, data), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

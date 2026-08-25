/**
 * /api/entities/[entity]/[id] — get / update / delete one row.
 *
 * A row that exists but belongs to someone else is a 404, not a 403: the RLS
 * predicate is applied in the query (`updateMany`/`deleteMany` + `count`, gotcha 1),
 * so this layer genuinely cannot tell the two apart — and shouldn't leak that it
 * could.
 *
 * DELETE is a hard delete. Base44 soft-deleted with a `/restore` endpoint, but the
 * schema has no `deletedAt` and nothing calls restore.
 */

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import { parseBody, resolveEntity } from "@/lib/entities";
import { deleteEntity, getEntity, updateEntity } from "@/lib/entityCrud";

type Ctx = { params: Promise<{ entity: string; id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { entity, id } = await params;
    const model = resolveEntity(entity);
    if (!model) return jsonError(404, "unknown_entity");

    const row = await getEntity(model, await requireSessionUser(), id);
    return row ? NextResponse.json(row) : jsonError(404, "not_found");
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { entity, id } = await params;
    const model = resolveEntity(entity);
    if (!model) return jsonError(404, "unknown_entity");

    const actor = await requireSessionUser();
    const data = parseBody(model, await req.json(), "update");

    const row = await updateEntity(model, actor, id, data);
    return row ? NextResponse.json(row) : jsonError(404, "not_found");
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { entity, id } = await params;
    const model = resolveEntity(entity);
    if (!model) return jsonError(404, "unknown_entity");

    const deleted = await deleteEntity(model, await requireSessionUser(), id);
    return deleted ? NextResponse.json({ success: true }) : jsonError(404, "not_found");
  } catch (err) {
    return errorResponse(err);
  }
}

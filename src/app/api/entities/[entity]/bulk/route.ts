/**
 * POST /api/entities/[entity]/bulk — Base44's bulk create, used by the
 * CSV importer (`Item.bulkCreate` in src/components/boards/ImportBoardModal.jsx).
 *
 * `PUT /bulk` (bulk update) has no call site here, so it is not implemented.
 */

import { NextResponse, type NextRequest } from "next/server";

import { errorResponse, jsonError } from "@/lib/apiResponse";
import { requireSessionUser } from "@/lib/auth";
import { parseBody, resolveEntity, ValidationError } from "@/lib/entities";
import { bulkCreateEntities, MAX_BULK } from "@/lib/entityCrud";

type Ctx = { params: Promise<{ entity: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const model = resolveEntity((await params).entity);
    if (!model) return jsonError(404, "unknown_entity");

    const actor = await requireSessionUser();
    const body = await req.json();

    if (!Array.isArray(body)) throw new ValidationError("body must be an array of records");
    if (body.length === 0) throw new ValidationError("body must not be empty");
    if (body.length > MAX_BULK)
      throw new ValidationError(`at most ${MAX_BULK} records per request`);

    // Validate every record before inserting any — createManyAndReturn is one
    // statement, so a late failure would otherwise be a partial import.
    const records = body.map((record) => parseBody(model, record, "create"));

    return NextResponse.json(await bulkCreateEntities(model, actor, records), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

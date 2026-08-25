/**
 * Uniform error shape for the JSON APIs. Callers branch on the status code
 * (`err.status === 401`), so the status is the contract and the body is
 * informational.
 */

import { NextResponse } from "next/server";

import { ValidationError } from "@/lib/entities";
import { UnauthenticatedError } from "@/lib/rls";

export function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json(detail ? { error, detail } : { error }, { status });
}

/**
 * Maps the two expected failures to 401/400 and everything else to a 500 with the
 * message swallowed — a Prisma error text can name columns and constraints.
 */
export function errorResponse(err: unknown) {
  if (err instanceof UnauthenticatedError) return jsonError(401, "unauthenticated");
  if (err instanceof ValidationError) return jsonError(400, "invalid_request", err.message);

  console.error("[api] unhandled error:", err);
  return jsonError(500, "internal_error");
}

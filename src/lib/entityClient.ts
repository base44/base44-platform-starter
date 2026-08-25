/**
 * Thin client over /api/entities.
 *
 * The method signatures deliberately mirror the Base44 SDK's entity modules, so a
 * component written against Base44 entities needs only its import changed:
 *
 *   Board.list("-updated_date", 10)          Board.create(data)
 *   Item.filter({ board_id }, "order_index") Item.bulkCreate(records)
 *   Board.update(id, data)                   Widget.delete(id)
 *
 * Browser-only: the URLs are relative, so the session cookie rides along. Server
 * components should call src/lib/entityCrud.ts directly instead of round-tripping.
 */

export type WireRecord = Record<string, unknown>;

/** Carries the status so callers can branch on `err.status === 401`. */
export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/entities${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data as { error?: string; detail?: string } | null;
    throw new ApiError(res.status, detail?.detail ?? detail?.error ?? res.statusText, data);
  }
  return data;
}

function query(filter: WireRecord | null, sortBy?: string, limit?: number, skip?: number): string {
  const params = new URLSearchParams();
  if (filter) params.set("q", JSON.stringify(filter));
  if (sortBy) params.set("sort_by", sortBy);
  if (limit !== undefined) params.set("limit", String(limit));
  if (skip !== undefined) params.set("skip", String(skip));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function entity(name: string) {
  const base = `/${name}`;
  return {
    list: (sortBy?: string, limit?: number, skip?: number) =>
      request(base + query(null, sortBy, limit, skip)) as Promise<WireRecord[]>,

    filter: (filter: WireRecord, sortBy?: string, limit?: number, skip?: number) =>
      request(base + query(filter, sortBy, limit, skip)) as Promise<WireRecord[]>,

    get: (id: string) => request(`${base}/${encodeURIComponent(id)}`) as Promise<WireRecord>,

    create: (data: WireRecord) =>
      request(base, { method: "POST", body: JSON.stringify(data) }) as Promise<WireRecord>,

    bulkCreate: (records: WireRecord[]) =>
      request(`${base}/bulk`, { method: "POST", body: JSON.stringify(records) }) as Promise<
        WireRecord[]
      >,

    update: (id: string, data: WireRecord) =>
      request(`${base}/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }) as Promise<WireRecord>,

    delete: (id: string) =>
      request(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }) as Promise<{
        success: true;
      }>,
  };
}

export const Board = entity("Board");
export const Item = entity("Item");
export const Widget = entity("Widget");
export const Team = entity("Team");
export const AppOwnership = entity("AppOwnership");

/** `base44.auth.me()` — see src/app/api/me/route.ts. */
export async function me(): Promise<WireRecord> {
  const res = await fetch("/api/me");
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, "not authenticated", data);
  return data as WireRecord;
}

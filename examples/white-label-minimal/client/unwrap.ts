import type { ActionResult } from "../types";

class ActionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Server actions return { data } or { error }. unwrap turns an error into an
// exception, so components can use try/catch.
export async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  let value: ActionResult<T>;
  try {
    value = await result;
  } catch {
    throw new ActionError("Connection lost. The operation may still be running.", 0);
  }
  if ("error" in value) throw new ActionError(value.error, value.status);
  return value.data;
}

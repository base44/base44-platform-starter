import "server-only";
import { Base44Error } from "./error";
import { getBase44Config } from "./config";

type Options = {
  body?: object | URLSearchParams;
  headers?: Record<string, string>;
  timeout?: number;
  errorFor?: (status: number) => Base44Error;
};

/** POST when there is a body, GET otherwise. Every failure is a Base44Error that is safe to show. */
export async function base44Fetch(path: string, { body, headers, timeout = 30_000, errorFor }: Options = {}) {
  const { host } = getBase44Config();
  const form = body instanceof URLSearchParams;
  let response: Response;
  try {
    response = await fetch(`${host}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
        ...headers,
      },
      body: form ? body : body && JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    // Never include fetch errors: they can contain a URL or upstream credentials.
    throw new Base44Error("Base44 did not return a response. The operation may still be running.", 504);
  }
  if (!response.ok) {
    throw errorFor?.(response.status) ?? new Base44Error(`Base44 returned ${response.status}.`, response.status);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Base44Error("Base44 returned an unreadable response. The outcome is uncertain.");
  }
}

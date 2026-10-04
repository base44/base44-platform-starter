import "server-only";

// Base44 does not return a static preview URL; we derive it from the slug.
// The derived URL can name a build that does not exist yet, and the host then
// answers with a JSON error that an iframe would show as raw JSON. So we probe
// it first, and cache the result because getApp is polled every two seconds.
const probes = new Map<string, { ok: boolean; at: number }>();

export async function staticPreviewUrl(slug: string | null | undefined) {
  const domain = process.env.BASE44_STATIC_PREVIEW_DOMAIN;
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return undefined;
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(slug)) return undefined;
  const url = `https://preview--${slug}.${domain}`;
  return (await servesHtml(url)) ? url : undefined;
}

async function servesHtml(url: string) {
  const cached = probes.get(url);
  if (cached && Date.now() - cached.at < 60_000) return cached.ok;
  const ok = await fetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(5_000) })
    .then((r) => r.ok && (r.headers.get("content-type") ?? "").includes("text/html"))
    .catch(() => false);
  probes.set(url, { ok, at: Date.now() });
  return ok;
}

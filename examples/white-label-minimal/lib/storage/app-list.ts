import type { App } from "../types";
import { Base44Error } from "../base44/error";

export async function resolveAppPage(
  rows: { appId: string }[],
  skip: number,
  getApp: (id: string) => Promise<App>,
  getPublishedUrl?: (id: string) => Promise<{ url: string | null }>,
) {
  const page = rows.slice(0, 12);
  const results = await Promise.all(
    page.map(async (row) => {
      try {
        // Publication is not part of an app summary upstream, so it takes its
        // own lookup. A failed lookup leaves `published` undefined rather than
        // false: the caller groups unpublished apps separately, and an outage
        // must not file someone's published app under drafts.
        const [app, published] = await Promise.all([
          getApp(row.appId),
          getPublishedUrl
            ? getPublishedUrl(row.appId).then(
                (result) => !!result.url,
                () => undefined,
              )
            : Promise.resolve(undefined),
        ]);
        return published === undefined ? app : { ...app, published };
      } catch (error) {
        if (error instanceof Base44Error && error.status === 404) return null;
        throw error;
      }
    }),
  );
  return {
    apps: results.filter((app): app is App => app !== null),
    hasMore: rows.length > 12,
    nextSkip: skip + page.length,
  };
}

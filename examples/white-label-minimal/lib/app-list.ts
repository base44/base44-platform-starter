import type { App } from './base44-client';
import { Base44Error } from './base44-server';

export async function resolveAppPage(
  rows: { appId: string }[],
  skip: number,
  getApp: (id: string) => Promise<App>,
) {
  const page = rows.slice(0, 12);
  const results = await Promise.all(page.map(async row => {
    try { return await getApp(row.appId); }
    catch (error) {
      if (error instanceof Base44Error && error.status === 404) return null;
      throw error;
    }
  }));
  return { apps: results.filter((app): app is App => app !== null), hasMore: rows.length > 12, nextSkip: skip + page.length };
}

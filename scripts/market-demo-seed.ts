/**
 * Seeds (or removes) a few example listings, so `/Marketplace` has something in it on
 * a local database.
 *
 * The point of the fixture is the **author**: these apps are owned by someone who is
 * not you, so installing one is genuinely installing another person's app rather than
 * running your own. That is the case viewer tokens exist for, and the only one worth
 * looking at.
 *
 * Nothing else is faked. The listing, the install (a `Widget` row), the
 * `sunny:auth:request` handshake and the viewer-scoped read are all the real code
 * paths — the apps in `public/market-demo/` call `/api/sunny` exactly the way a
 * deployed Base44 app would. Only their hosting is local.
 *
 *   npx tsx --env-file=.env scripts/market-demo-seed.ts
 *   npx tsx --env-file=.env scripts/market-demo-seed.ts --remove
 */

import { prisma } from "../src/lib/prisma";

const DEMO_AUTHOR = "demo-author@example.com";
const PREFIX = "demo-";

const APPS = [
  {
    appId: "demo-weekly-report",
    title: "Weekly report",
    tagline: "How much is done on each board, at a glance",
    category: "Reporting",
    appUrl: "/market-demo/weekly-report.html",
  },
  {
    appId: "demo-my-week",
    title: "My week",
    tagline: "Everything dated in the next seven days, in order",
    category: "Planning",
    appUrl: "/market-demo/my-week.html",
  },
  {
    appId: "demo-quick-capture",
    title: "Quick capture",
    tagline: "Add a task to any board without leaving the page",
    category: "Productivity",
    appUrl: "/market-demo/quick-capture.html",
  },
];

async function main() {
  if (process.argv.includes("--remove")) {
    const listings = await prisma.marketplaceListing.deleteMany({ where: { appId: { startsWith: PREFIX } } });
    const owned = await prisma.appOwnership.deleteMany({ where: { appId: { startsWith: PREFIX } } });
    const widgets = await prisma.widget.deleteMany({ where: { appId: { startsWith: PREFIX } } });
    const users = await prisma.user.deleteMany({ where: { email: DEMO_AUTHOR } });
    console.log(
      `removed ${listings.count} listing(s), ${owned.count} ownership(s), ` +
        `${widgets.count} widget(s), ${users.count} user(s)`,
    );
    return;
  }

  await prisma.user.upsert({
    where: { email: DEMO_AUTHOR },
    create: { email: DEMO_AUTHOR, fullName: "Demo Author" },
    update: {},
  });

  for (const app of APPS) {
    // Ownership first: publish() checks it, and it is what answers "whose app is this".
    await prisma.appOwnership.upsert({
      where: { appId_createdBy: { appId: app.appId, createdBy: DEMO_AUTHOR } },
      create: { appId: app.appId, appName: app.title, createdBy: DEMO_AUTHOR },
      update: {},
    });
    await prisma.marketplaceListing.upsert({
      where: { appId: app.appId },
      create: { ...app, appSlug: null, screenshotUrl: null, status: "published", publishedAt: new Date(), createdBy: DEMO_AUTHOR },
      update: { ...app, status: "published" },
    });
  }

  console.log(`seeded ${APPS.length} listings by ${DEMO_AUTHOR}:`);
  for (const a of APPS) console.log(`  · ${a.title}`);
  console.log("\nopen Sunny and click Market in the top nav.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

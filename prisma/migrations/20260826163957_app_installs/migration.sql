-- CreateTable
CREATE TABLE "app_installs" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_name" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_installs_created_by_idx" ON "app_installs"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "app_installs_app_id_created_by_key" ON "app_installs"("app_id", "created_by");

-- Backfill: the grant used to be the Widget row. /api/sunny/token now gates on
-- app_installs, so without this every app anyone has pinned would lose access to
-- their data the moment this deploys. One install per (app, user) already pinned.
INSERT INTO "app_installs" ("id", "app_id", "app_name", "created_by", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  w."app_id",
  MIN(w."app_name"),
  w."created_by",
  MIN(w."created_at"),
  NOW()
FROM "widgets" w
GROUP BY w."app_id", w."created_by"
ON CONFLICT ("app_id", "created_by") DO NOTHING;

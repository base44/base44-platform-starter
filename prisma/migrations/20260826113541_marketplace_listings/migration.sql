-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('draft', 'published', 'delisted');

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT,
    "category" TEXT,
    "app_slug" TEXT,
    "app_url" TEXT,
    "screenshot_url" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_app_id_key" ON "marketplace_listings"("app_id");

-- CreateIndex
CREATE INDEX "marketplace_listings_created_by_idx" ON "marketplace_listings"("created_by");

-- CreateIndex
CREATE INDEX "marketplace_listings_status_idx" ON "marketplace_listings"("status");

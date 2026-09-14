-- CreateEnum
CREATE TYPE "Base44AppLifecycle" AS ENUM ('active', 'trashed');

-- CreateTable
CREATE TABLE "base44_webhook_events" (
    "id" TEXT NOT NULL,
    "cloud_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "app_id" TEXT,
    "workspace_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "base44_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base44_app_states" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "lifecycle" "Base44AppLifecycle" NOT NULL DEFAULT 'active',
    "owner_email" TEXT,
    "published_version" TEXT,
    "published_at" TIMESTAMP(3),
    "unpublished_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "base44_app_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The de-duplication mechanism, not a diagnostic: delivery is at-least-once, so
-- this unique constraint is what makes a redelivered event a no-op.
CREATE UNIQUE INDEX "base44_webhook_events_cloud_event_id_key" ON "base44_webhook_events"("cloud_event_id");

-- CreateIndex
CREATE INDEX "base44_webhook_events_event_type_received_at_idx" ON "base44_webhook_events"("event_type", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "base44_app_states_app_id_key" ON "base44_app_states"("app_id");

-- CreateIndex
CREATE INDEX "base44_app_states_owner_email_idx" ON "base44_app_states"("owner_email");

-- No backfill. State here is whatever the event stream has said since the
-- endpoint was activated, and Base44 deliberately does not replay history to a
-- newly registered endpoint — so an app built before this deploys has no row
-- until its next transition. Readers treat a missing row as "nothing has been
-- reported", never as "trashed".

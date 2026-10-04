-- The webhook receiver keeps no state: an app.deleted.v1 removes the owner's
-- dashboard pins, which is idempotent and order-safe on its own.
DROP TABLE "base44_webhook_events";
DROP TABLE "base44_app_states";
DROP TYPE "Base44AppNotice";
DROP TYPE "Base44AppLifecycle";

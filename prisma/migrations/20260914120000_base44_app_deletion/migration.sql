-- CreateEnum
CREATE TYPE "Base44AppNotice" AS ENUM ('deleted', 'restored');

-- AlterTable
-- `app_name` is the shell's own last-known name for the app, not the event's:
-- app lifecycle payloads deliberately carry nothing a user authored. It is
-- captured off the Widget/AppOwnership rows just before they are removed, which
-- is why it has to outlive them.
ALTER TABLE "base44_app_states" ADD COLUMN     "app_name" TEXT,
ADD COLUMN     "notice_at" TIMESTAMP(3),
ADD COLUMN     "pending_notice" "Base44AppNotice";

-- No backfill, and no index on `pending_notice`. The claim query is
-- `(owner_email, pending_notice IS NOT NULL)` and `base44_app_states_owner_email_idx`
-- already bounds it to one user's apps, which is a handful of rows.

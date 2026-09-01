-- The calendar view is gone from the product, so `calendar` leaves BoardViewType.
-- Any board still parked on it lands on the default view rather than on nothing:
-- the value has to go before the type can be recreated without it.
UPDATE "boards" SET "view_type" = 'table' WHERE "view_type" = 'calendar';

-- AlterEnum
BEGIN;
CREATE TYPE "BoardViewType_new" AS ENUM ('table', 'kanban');
ALTER TABLE "boards" ALTER COLUMN "view_type" DROP DEFAULT;
ALTER TABLE "boards" ALTER COLUMN "view_type" TYPE "BoardViewType_new" USING ("view_type"::text::"BoardViewType_new");
ALTER TYPE "BoardViewType" RENAME TO "BoardViewType_old";
ALTER TYPE "BoardViewType_new" RENAME TO "BoardViewType";
DROP TYPE "BoardViewType_old";
ALTER TABLE "boards" ALTER COLUMN "view_type" SET DEFAULT 'table';
COMMIT;

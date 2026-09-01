-- Drop teams.
--
-- `teams` was decorative: rows were owner-scoped like every other user-owned
-- model, so two users could never see the same team, `member_emails` was written
-- by the invite modal and read by nothing, and `boards.team_id` was never written
-- or read at all. Sharing would mean replacing the `created_by` predicate in
-- src/lib/rls.ts with a membership predicate — a different product, not this one.

-- DropForeignKey
ALTER TABLE "boards" DROP CONSTRAINT "boards_team_id_fkey";

-- DropIndex
DROP INDEX "boards_team_id_idx";

-- AlterTable
ALTER TABLE "boards" DROP COLUMN "team_id";

-- DropTable
DROP TABLE "teams";

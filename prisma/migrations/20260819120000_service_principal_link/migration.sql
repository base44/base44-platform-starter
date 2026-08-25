-- Base44 moved token vending from "mint for a real, SCIM-resolved workspace
-- member" to "mint for a synthetic service principal". The link row now tracks
-- an opaque principal id instead of leaning on the user's email being the
-- Base44 identity.

-- The principal id. NULL for rows migrated from the old design: those users are
-- SCIM members, not service principals, so they must reconnect once.
ALTER TABLE "base44_links" ADD COLUMN "service_external_id" TEXT;

-- Renaming would carry the old meaning forward as a lie: a SCIM member is a
-- different identity from a service principal, so every existing row is
-- principal_provisioned = false. Dropping is the honest migration.
ALTER TABLE "base44_links" DROP COLUMN "scim_provisioned";
ALTER TABLE "base44_links" ADD COLUMN "principal_provisioned" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "base44_links_service_external_id_key" ON "base44_links"("service_external_id");

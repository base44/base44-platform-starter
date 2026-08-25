-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "BoardVisibility" AS ENUM ('private', 'shared');

-- CreateEnum
CREATE TYPE "BoardViewType" AS ENUM ('table', 'kanban', 'calendar');

-- CreateEnum
CREATE TYPE "ItemPriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "Base44LinkStatus" AS ENUM ('pending', 'linked');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "image_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0073EA',
    "member_emails" TEXT[],
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0073EA',
    "visibility" "BoardVisibility" NOT NULL DEFAULT 'private',
    "view_type" "BoardViewType" NOT NULL DEFAULT 'table',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "groups" JSONB NOT NULL DEFAULT '[]',
    "team_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order_index" DOUBLE PRECISION,
    "data" JSONB NOT NULL DEFAULT '{}',
    "priority" "ItemPriority" NOT NULL DEFAULT 'medium',
    "color" TEXT,
    "board_id" TEXT NOT NULL,
    "group_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widgets" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "app_slug" TEXT,
    "preview_url" TEXT,
    "preview_screenshot_url" TEXT,
    "order_index" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 320,
    "col_span" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_ownerships" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "app_name" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base44_links" (
    "id" TEXT NOT NULL,
    "app_user_email" TEXT NOT NULL,
    "status" "Base44LinkStatus" NOT NULL DEFAULT 'pending',
    "access_token" TEXT,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "organization_id" TEXT,
    "base44_user_email" TEXT,
    "scim_provisioned" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "base44_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "teams_created_by_idx" ON "teams"("created_by");

-- CreateIndex
CREATE INDEX "boards_created_by_idx" ON "boards"("created_by");

-- CreateIndex
CREATE INDEX "boards_team_id_idx" ON "boards"("team_id");

-- CreateIndex
CREATE INDEX "items_created_by_idx" ON "items"("created_by");

-- CreateIndex
CREATE INDEX "items_board_id_order_index_idx" ON "items"("board_id", "order_index");

-- CreateIndex
CREATE INDEX "widgets_created_by_order_index_idx" ON "widgets"("created_by", "order_index");

-- CreateIndex
CREATE INDEX "app_ownerships_created_by_idx" ON "app_ownerships"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "app_ownerships_app_id_created_by_key" ON "app_ownerships"("app_id", "created_by");

-- CreateIndex
CREATE UNIQUE INDEX "base44_links_app_user_email_key" ON "base44_links"("app_user_email");

-- CreateIndex
CREATE INDEX "base44_links_created_by_idx" ON "base44_links"("created_by");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

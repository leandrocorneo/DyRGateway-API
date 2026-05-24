-- CreateTable
CREATE TABLE "service_types" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "service_types_pkey" PRIMARY KEY ("id")
);

-- AddColumn (default for existing rows)
ALTER TABLE "services" ADD COLUMN "serviceTypeId" TEXT DEFAULT '00000000-0000-0000-0000-000000000001';

-- Seed default HTTP type
INSERT INTO "service_types" ("id", "description")
VALUES ('00000000-0000-0000-0000-000000000001', 'http');

-- Backfill existing services
UPDATE "services"
SET "serviceTypeId" = '00000000-0000-0000-0000-000000000001'
WHERE "serviceTypeId" IS NULL;

-- Enforce required relation
ALTER TABLE "services" ALTER COLUMN "serviceTypeId" SET NOT NULL;

-- Remove default for new rows
ALTER TABLE "services" ALTER COLUMN "serviceTypeId" DROP DEFAULT;

-- Drop old type column
ALTER TABLE "services" DROP COLUMN "type";

-- CreateIndex
CREATE INDEX "services_serviceTypeId_idx" ON "services"("serviceTypeId");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_serviceTypeId_fkey"
FOREIGN KEY ("serviceTypeId") REFERENCES "service_types"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
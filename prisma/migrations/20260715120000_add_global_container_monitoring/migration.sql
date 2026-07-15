CREATE TABLE "monitored_containers" (
  "id" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "identitySource" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "image" TEXT NOT NULL,
  "composeProject" TEXT,
  "composeService" TEXT,
  "composeContainerNumber" INTEGER,
  "currentContainerId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "health" TEXT,
  "present" BOOLEAN NOT NULL DEFAULT true,
  "mounts" JSONB NOT NULL,
  "containerCreatedAt" TIMESTAMP(3),
  "instanceStartedAt" TIMESTAMP(3),
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "monitored_containers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "infrastructure_metric_samples"
  ADD COLUMN "monitoredContainerId" TEXT,
  ADD COLUMN "containerInstanceId" TEXT;

CREATE UNIQUE INDEX "monitored_containers_identityKey_key" ON "monitored_containers"("identityKey");
CREATE INDEX "monitored_containers_present_state_idx" ON "monitored_containers"("present", "state");
CREATE INDEX "monitored_containers_composeProject_composeService_composeContainerNumber_idx" ON "monitored_containers"("composeProject", "composeService", "composeContainerNumber");
CREATE INDEX "monitored_containers_lastSeenAt_idx" ON "monitored_containers"("lastSeenAt");
CREATE INDEX "infrastructure_metric_samples_monitoredContainerId_sampledAt_idx" ON "infrastructure_metric_samples"("monitoredContainerId", "sampledAt");

ALTER TABLE "infrastructure_metric_samples"
  ADD CONSTRAINT "infrastructure_metric_samples_monitoredContainerId_fkey"
  FOREIGN KEY ("monitoredContainerId") REFERENCES "monitored_containers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

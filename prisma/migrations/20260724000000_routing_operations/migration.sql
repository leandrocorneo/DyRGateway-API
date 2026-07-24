ALTER TABLE "monitored_containers" ADD COLUMN "ports" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "routing_container_preferences" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_container_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "compose_project_operations" (
    "id" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "workingDirectory" TEXT NOT NULL,
    "composeFile" TEXT NOT NULL DEFAULT 'docker-compose.yml',
    "branch" TEXT,
    "image" TEXT,
    "canRestart" BOOLEAN NOT NULL DEFAULT true,
    "canRebuild" BOOLEAN NOT NULL DEFAULT false,
    "canRedeploy" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compose_project_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "routing_container_preferences_serviceId_key" ON "routing_container_preferences"("serviceId");
CREATE INDEX "routing_container_preferences_containerId_idx" ON "routing_container_preferences"("containerId");
CREATE UNIQUE INDEX "compose_project_operations_project_key" ON "compose_project_operations"("project");
CREATE INDEX "compose_project_operations_active_idx" ON "compose_project_operations"("active");

ALTER TABLE "routing_container_preferences" ADD CONSTRAINT "routing_container_preferences_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

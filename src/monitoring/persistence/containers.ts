import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { MonitoredContainerInput } from '../collectors/docker';

const json = (value: unknown) => value as Prisma.InputJsonValue;

export const upsertMonitoredContainer = async (item: MonitoredContainerInput) => {
  const observedAt = new Date(item.observedAt);
  const data = {
    identityKey: item.identityKey,
    identitySource: item.identitySource,
    name: item.name,
    image: item.image,
    composeProject: item.composeProject,
    composeService: item.composeService,
    composeContainerNumber: item.composeContainerNumber,
    currentContainerId: item.currentContainerId,
    state: item.state,
    health: item.health,
    present: true,
    mounts: json(item.mounts),
    ports: json(item.ports),
    containerCreatedAt: item.containerCreatedAt ? new Date(item.containerCreatedAt) : null,
    instanceStartedAt: item.instanceStartedAt ? new Date(item.instanceStartedAt) : null,
    lastSeenAt: observedAt,
  };
  return prisma.monitoredContainer.upsert({
    where: { identityKey: item.identityKey },
    create: { id: item.id, firstSeenAt: observedAt, ...data },
    update: data,
  });
};

export const markMissingMonitoredContainers = async (observedAt: string | Date) =>
  prisma.monitoredContainer.updateMany({
    where: { present: true, lastSeenAt: { lt: new Date(observedAt) } },
    data: { present: false },
  });

export const deleteExpiredMonitoredContainers = async (before: Date) =>
  prisma.monitoredContainer.deleteMany({
    where: { present: false, lastSeenAt: { lt: before } },
  });

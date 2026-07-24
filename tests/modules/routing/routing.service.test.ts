import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../../../src/database/prisma';
import RoutingService from '../../../src/modules/routing/routing.service';

const HTTP_SERVICE_TYPE_ID = '00000000-0000-0000-0000-000000000001';
const suffix = () => String(Date.now()) + '-' + Math.random().toString(16).slice(2);

const cleanup = async (slug: string, containerId: string) => {
  await prisma.routingContainerPreference.deleteMany({ where: { containerId } });
  await prisma.service.deleteMany({ where: { application: { slug } } });
  await prisma.domain.deleteMany({ where: { application: { slug } } });
  await prisma.application.deleteMany({ where: { slug } });
  await prisma.monitoredContainer.deleteMany({ where: { id: containerId } });
};

test('builds routing overview with suggested and visual selected containers', async () => {
  const id = suffix();
  const slug = 'routing-test-' + id;
  const containerId = 'routing-container-' + id;
  await cleanup(slug, containerId);
  await prisma.serviceType.upsert({
    where: { id: HTTP_SERVICE_TYPE_ID },
    create: { id: HTTP_SERVICE_TYPE_ID, description: 'HTTP' },
    update: {},
  });

  try {
    const app = await prisma.application.create({ data: { name: 'Routing Test', slug, active: true } });
    await prisma.domain.create({ data: { host: slug + '.example.com', applicationId: app.id } });
    const service = await prisma.service.create({
      data: {
        applicationId: app.id,
        serviceTypeId: HTTP_SERVICE_TYPE_ID,
        path: '/',
        targetHost: 'web',
        targetPort: 3000,
        active: true,
      },
    });
    await prisma.monitoredContainer.create({
      data: {
        id: containerId,
        identityKey: 'compose:routing:web:1:' + id,
        identitySource: 'compose',
        name: 'routing-web-1',
        image: 'web:latest',
        composeProject: 'routing',
        composeService: 'web',
        composeContainerNumber: 1,
        currentContainerId: 'instance-' + id,
        state: 'running',
        health: 'healthy',
        present: true,
        mounts: [],
        ports: [{ containerPort: 3000, protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 9300, published: true }],
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    const routing = new RoutingService();
    const first = await routing.overview();
    const entry = first.entries.find((item: any) => item.service?.id === service.id);
    assert.equal(entry?.suggestedContainer?.id, containerId);
    assert.equal(entry?.selectedContainer, null);
    assert.equal(entry?.tls.status, 'not-applicable');

    await routing.updatePreference(service.id, { containerId });
    const second = await routing.overview();
    const selected = second.entries.find((item: any) => item.service?.id === service.id);
    assert.equal(selected?.selectedContainer?.id, containerId);
    assert.equal(selected?.matchSource, 'preference');
  } finally {
    await cleanup(slug, containerId);
  }
});
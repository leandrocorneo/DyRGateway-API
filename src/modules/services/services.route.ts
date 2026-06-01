import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import ServicesService from './services.service';
import { CreateServiceDTO, UpdateServiceDTO } from './services.types';
import { PaginationOptions } from '../../shared/types';

const serviceRoutes: FastifyPluginAsync = async (fastify) => {
    const servicesService = new ServicesService();

    fastify.get(
        '/services',
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const services = await servicesService.listServices(request.query as PaginationOptions);
            return reply.send(services);
        }
    );

    fastify.get<{ Params: { id: string } }>(
        '/services/:id',
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            const service = await servicesService.findById(request.params.id);
            if (!service) {
                return reply.status(404).send({ message: 'Service not found' });
            }
            return reply.send(service);
        }
    );

    fastify.post<{ Body: CreateServiceDTO }>(
        '/services', 
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            try {
                const service = await servicesService.createService(request.body);
                return reply.status(201).send(service);
            } catch (error) {
                return reply.status(400).send({ message: (error as Error).message });
            }
        }
    );

    fastify.put<{ Params: { id: string }; Body: UpdateServiceDTO }>(
        '/services/:id',
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            try {
                const service = await servicesService.updateService(request.params.id, request.body);
                return reply.send(service);
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                    return reply.status(404).send({ message: 'Service not found' });
                }

                return reply.status(400).send({ message: (error as Error).message });
            }
        }
    );

    fastify.delete<{ Params: { id: string } }>(
        '/services/:id',
        { preHandler: [fastify.authenticate] },
        async (request, reply) => {
            try {
                await servicesService.deleteService(request.params.id);
                return reply.status(204).send();
            } catch (error) {
                return reply.status(400).send({ message: (error as Error).message });
            }
        }
    );
};

export default serviceRoutes;

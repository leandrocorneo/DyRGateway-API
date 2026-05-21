import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import ServicesService from './services.service';
import { CreateServiceDTO } from './services.types';
import { PaginationOptions } from '../../shared/types';

const serviceRoutes: FastifyPluginAsync = async (fastify) => {
    const servicesService = new ServicesService();

    fastify.get(
        '/services',
        async (request, reply) => {
            const services = await servicesService.listServices(request.query as PaginationOptions);
            return reply.send(services);
        }
    );

    fastify.get(
        '/services/:id',
        async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
            const service = await servicesService.findById(request.params.id);
            if (!service) {
                return reply.status(404).send({ message: 'Service not found' });
            }
            return reply.send(service);
        }
    );

    fastify.post(
        '/services', 
        async (request: FastifyRequest<{ Body: CreateServiceDTO }>, reply) => {
            try {
                const service = await servicesService.createService(request.body);
                return reply.status(201).send(service);
            } catch (error) {
                return reply.status(400).send({ message: (error as Error).message });
            }
        }
    );

    fastify.delete(
        '/services/:id',
        async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
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
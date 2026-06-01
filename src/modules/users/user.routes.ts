import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { CreateUserDTO } from "./user.types";
import { UserService } from "./user.service";
import UserRepository from "./user.repository";

const userRoutes: FastifyPluginAsync = async (fastify) => {
    const userService = new UserService();

    fastify.post('/users', async (
        request: FastifyRequest<{ Body: CreateUserDTO }>,
        reply: FastifyReply
    ) => {
        try {
            const user = await userService.createUser(request.body);
            reply.status(201).send(user);
        } catch (error) {
            reply.status(400).send({ message: (error as Error).message });
        }
    });
}

export default userRoutes;
import { FastifyPluginAsync } from "fastify";
import { CreateUserDTO } from "./user.types";
import { UserService } from "./user.service";

const userRoutes: FastifyPluginAsync = async (fastify) => {
    const userService = new UserService();

    fastify.post<{ Body: CreateUserDTO }>('/users', { preHandler: [fastify.authenticate] }, async (
        request,
        reply
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
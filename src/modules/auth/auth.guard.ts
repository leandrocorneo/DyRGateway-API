import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
    interface FastifyInstance {
        authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    }
}

export function registerAuthGuard(fastify: FastifyInstance) {
    fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const token = request.cookies?.access_token;

            if (!token) {
                reply.status(401).send({ message: "Unauthorized" });
                return;
            }

            await fastify.jwt.verify(token);
        } catch (error) {
            reply.status(401).send({ message: "Unauthorized" });
        }
    });
}

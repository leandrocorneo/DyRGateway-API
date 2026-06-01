import { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../../config/env";
import { AuthService } from "./auth.service";

const authRoutes: FastifyPluginAsync = async (fastify) => {
    const authService = new AuthService();

    fastify.post('/login', async (
        request: FastifyRequest <{ Body: { email: string, password: string } }>,
        reply: FastifyReply
    ) => {
        try {
            const { email, password } = request.body;
            const user = await authService.login(email, password);

            if (!user) {
                return reply.status(401).send({ error: 'Invalid credentials' });
            }

            const token = fastify.jwt.sign({ userId: user.id });

            reply.setCookie('access_token', token, {
                httpOnly: true,
                secure: config.nodeEnv === 'production',
                sameSite: 'strict',
                path: '/',
            });

            return reply.send({ message: 'Login successful' });

        } catch (error) {
            reply.status(500).send({ error: 'Internal server error' });
        }
    });

    fastify.post('/logout', { preHandler: [fastify.authenticate] }, async (
        request: FastifyRequest, 
        reply: FastifyReply
    ) => {
        reply.clearCookie('access_token', {
            httpOnly: true,
            secure: config.nodeEnv === 'production',
            sameSite: 'strict',
            path: '/',
        });

        return reply.send({ message: 'Logout successful' });
    });

};

export default authRoutes;
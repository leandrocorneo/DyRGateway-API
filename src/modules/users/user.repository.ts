import { prisma } from "../../database/prisma";
import { hashPassword } from "../../shared/utils";
import { CreateUserDTO } from "./user.types";

export default class UserRepository {
    
    async createUser(data: CreateUserDTO) {
        const passwordHash = await hashPassword(data.password);
        return prisma.user.create({
            data: {
                email: data.email,
                password: passwordHash,
                active: data.active ?? true,
            }
        });
    }

}
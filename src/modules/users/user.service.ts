import UserRepository from "./user.repository";
import { CreateUserDTO } from "./user.types";

export class UserService {
    private readonly userRepository: UserRepository;

    constructor(userRepository = new UserRepository()) {
        this.userRepository = userRepository;
    }

    async createUser(data: CreateUserDTO) {
        return this.userRepository.createUser(data);
    }

    async findByEmail(email: string) {
        return this.userRepository.findByEmail(email);
    }
}
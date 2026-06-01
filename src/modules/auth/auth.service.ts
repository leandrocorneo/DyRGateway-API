import { comparePassword } from "../../shared/utils";
import { UserService } from "../users/user.service";

export class AuthService {

    private readonly userService: UserService;
    constructor(userService = new UserService()) {
        this.userService = userService;
    }

    async login(email: string, password: string) {
        const user = await this.userService.findByEmail(email);

        if (!user) {
            return null;
        }

        const isPasswordValid = await comparePassword(password, user.password);

        if (!isPasswordValid) {
            return null;
        }

        return { id: user.id, email: user.email };
    }
}
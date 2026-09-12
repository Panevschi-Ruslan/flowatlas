import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  findAll(): string[] {
    return ['ada', 'linus'];
  }

  findOne(id: string): string {
    return `user-${id}`;
  }
}

import { Controller, Delete, Get, Post } from '@nestjs/common';

import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  findAll(): Promise<unknown[]> {
    return this.users.findAll();
  }

  @Post()
  create(): Promise<unknown[]> {
    return this.users.create('someone@example.com');
  }

  @Delete()
  remove(): Promise<number> {
    return this.users.remove('1');
  }
}

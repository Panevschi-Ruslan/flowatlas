import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** The generated client, wrapped so the container can hand it out. */
@Injectable()
export class PrismaService extends PrismaClient {}

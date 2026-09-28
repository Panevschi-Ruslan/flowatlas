import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { isGeneratedPrismaClient, parsePrismaSchema, prismaTableOf } from './prisma-schema.js';

const SCHEMA = `
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/client"
}

model User {
  id String @id
  settings Json @default("{}")

  @@map(name: "users")
}

model BookingSeat {
  id String @id
  @@map("booking_seats")
}

model Order {
  id String @id
}
`;

describe('what a Prisma schema states', () => {
  it('maps each delegate to its model’s table, the model’s own name unless @@map says otherwise', () => {
    const { tables } = parsePrismaSchema(SCHEMA, '/repo/prisma');
    expect(tables.get('user')).toBe('users');
    expect(tables.get('bookingSeat')).toBe('booking_seats');
    expect(tables.get('order')).toBe('Order');
    expect(tables.get('constructor')).toBeUndefined();
  });

  it('resolves a client generator’s output against the schema’s own directory', () => {
    expect(parsePrismaSchema(SCHEMA, '/repo/prisma').clientOutputs).toEqual(['/repo/src/generated/client']);
  });

  it('finds the schema at or above the file a client is stated in', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.getFileSystem().writeFileSync('/repo/prisma/schema.prisma', SCHEMA);
    const file = project.createSourceFile('/repo/src/db.ts', 'export {};');
    expect(isGeneratedPrismaClient(file, '/repo/src/generated/client')).toBe(true);
    expect(isGeneratedPrismaClient(file, '/repo/src/generated/client/index')).toBe(true);
    expect(isGeneratedPrismaClient(file, '/repo/src/generated/clientele')).toBe(false);
    expect(prismaTableOf(file, 'user')).toBe('users');
  });

  it('answers nothing where no schema is readable, so the call keeps its own word', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('/repo/src/db.ts', 'export {};');
    expect(prismaTableOf(file, 'user')).toBeUndefined();
  });
});

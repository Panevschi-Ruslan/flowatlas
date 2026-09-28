import { Node, Project, SyntaxKind, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { statedOrigin } from './stated.js';

/**
 * What the first method call in the source was made on.
 *
 * The real caller hands this function a receiver expression and nothing else, so
 * the cases are written as the call they are about rather than as a node picked
 * out by hand. The outermost call comes first in the walk, which is the one the
 * pass classifies.
 */
const receiverIn = (source: string): TsNode => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/base.ts', 'export class LocalBase {}');
  const file = project.createSourceFile('/a.ts', source);
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee)) return callee.getExpression();
  }
  throw new Error('the source must hold a method call');
};

describe('the type the source states for a receiver', () => {
  it('reads a constructor parameter property annotated with an imported type', () => {
    const origin = statedOrigin(
      receiverIn(`
        import { Kysely } from 'kysely';
        class Service {
          constructor(private readonly db: Kysely<unknown>) {}
          all() { return this.db.selectFrom('asset'); }
        }
      `),
    );
    expect(origin?.package).toBe('kysely');
    expect(origin?.typeName).toBe('Kysely');
  });

  it('reads a parameter of a free function, which is where a builder is handed over', () => {
    const origin = statedOrigin(
      receiverIn(`
        import type { ExpressionBuilder } from 'kysely';
        export const withFaces = (eb: ExpressionBuilder<unknown, 'asset'>) =>
          eb.selectFrom('asset_face');
      `),
    );
    expect(origin?.package).toBe('kysely');
  });

  it('reads a subpath import as an import of the package', () => {
    const origin = statedOrigin(
      receiverIn(`
        import { Kysely } from 'kysely/dist/esm';
        class Service {
          constructor(private readonly db: Kysely<unknown>) {}
          all() { return this.db.selectFrom('asset'); }
        }
      `),
    );
    expect(origin?.package).toBe('kysely');
  });

  it('walks a project’s own bases to the one a package declares', () => {
    const origin = statedOrigin(
      receiverIn(`
        import { Model } from 'sequelize-typescript';
        class BaseModel extends Model {}
        class Document extends BaseModel {}
        const rows = Document.findAll();
      `),
    );
    expect(origin?.package).toBe('sequelize-typescript');
    expect(origin?.typeName).toBe('Model');
    // The class is carried, because a locator reading the receiver's declaration
    // has it here to read; a type declared in a package nobody installed does
    // not, and that case leaves it out.
    expect(origin?.declaration && Node.isClassDeclaration(origin.declaration)).toBe(true);
  });

  it('says nothing when the type is declared in this repository', () => {
    expect(
      statedOrigin(
        receiverIn(`
          import { LocalBase } from './base.js';
          class Store extends LocalBase {}
          const rows = Store.findAll();
        `),
      ),
    ).toBeNull();
  });

  it('says nothing when there is no annotation to read', () => {
    expect(
      statedOrigin(
        receiverIn(`
          import { makeDb } from './base.js';
          const db = makeDb();
          const rows = db.selectFrom('asset');
        `),
      ),
    ).toBeNull();
  });

  it('says nothing about a receiver that is not a name', () => {
    expect(
      statedOrigin(
        receiverIn(`
          import { Kysely } from 'kysely';
          declare const of: (n: number) => Kysely<unknown>;
          const rows = of(1).selectFrom('asset');
        `),
      ),
    ).toBeNull();
  });
});

/**
 * The client a Prisma call is made through: the receiver of the first method
 * call, one step further out, since the receiver itself is the model's delegate.
 * Beside `a.ts`, the project holds whatever other files the case needs.
 */
const clientIn = (source: string, others: Record<string, string> = {}): TsNode => {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, text] of Object.entries(others)) {
    if (path.endsWith('.ts')) project.createSourceFile(path, text);
    else project.getFileSystem().writeFileSync(path, text);
  }
  const file = project.createSourceFile('/app/a.ts', source);
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && Node.isPropertyAccessExpression(callee.getExpression())) {
      return callee.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
    }
  }
  throw new Error('the source must hold a call through a delegate');
};

const SCHEMA = `
generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}

generator zod {
  provider = "zod-prisma-types"
  output   = "./zod"
}
`;

describe('a Prisma client whose generated code does not exist', () => {
  it('reads a client constructed from the package', () => {
    const origin = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        const client = new PrismaClient();
        const rows = client.order.findMany();
      `),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('reads the constructing side of a remembered client', () => {
    const origin = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        const client = (globalThis as { c?: PrismaClient }).c ?? new PrismaClient();
        const rows = client.order.findMany();
      `),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('follows an imported client into the wrapper and out to the directory the schema generates', () => {
    const origin = statedOrigin(
      clientIn(
        `
          import { prisma } from '../db/index';
          const rows = prisma.booking.findMany();
        `,
        {
          '/db/schema.prisma': SCHEMA,
          '/db/index.ts': `
            import { PrismaClient } from './generated/prisma/client';
            export const prisma: PrismaClient = new PrismaClient();
          `,
        },
      ),
    );
    expect(origin?.package).toBe('@prisma/client');
    expect(origin?.statedIn.getFilePath()).toBe('/db/index.ts');
  });

  it('does not take the output of a generator that writes something else for a client', () => {
    expect(
      statedOrigin(
        clientIn(
          `
            import { prisma } from '../db/index';
            const rows = prisma.booking.findMany();
          `,
          {
            '/db/schema.prisma': SCHEMA,
            '/db/index.ts': `
              import { PrismaClient } from './zod/client';
              export const prisma: PrismaClient = new PrismaClient();
            `,
          },
        ),
      ),
    ).toBeNull();
  });

  it('does not take a missing module for a client when no schema says it generates one', () => {
    expect(
      statedOrigin(
        clientIn(
          `
            import { prisma } from '../db/index';
            const rows = prisma.booking.findMany();
          `,
          {
            '/db/index.ts': `
              import { PrismaClient } from './generated/prisma/client';
              export const prisma: PrismaClient = new PrismaClient();
            `,
          },
        ),
      ),
    ).toBeNull();
  });

  it('does not read a value named prisma that nothing traces to a client', () => {
    expect(
      statedOrigin(
        clientIn(`
          const prisma = { order: { findMany: async () => [] } };
          const rows = prisma.order.findMany();
        `),
      ),
    ).toBeNull();
    expect(
      statedOrigin(
        clientIn(`
          export const load = (prisma: any) => prisma.order.findMany();
        `),
      ),
    ).toBeNull();
  });

  it('does not read a value by the package it was imported from', () => {
    // A package exports values of every type, not only its own; a value is read
    // by what its declaration states.
    expect(
      statedOrigin(
        clientIn(`
          import { prisma } from '@prisma/client';
          const rows = prisma.order.findMany();
        `),
      ),
    ).toBeNull();
  });

  it('reads a client narrowed by the language’s own derivations as the client', () => {
    const origin = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        type Orders = Pick<PrismaClient, 'order'>;
        export const settle = (db: Orders) => db.order.updateMany({});
      `),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('follows a client loaded by an import written as an expression', () => {
    const origin = statedOrigin(
      clientIn(
        `
          export const load = async () => {
            const prisma = (await import('../db/index')).default;
            return prisma.user.findMany();
          };
        `,
        {
          '/db/index.ts': `
            import { PrismaClient } from '@prisma/client';
            const prisma = new PrismaClient();
            export default prisma;
          `,
        },
      ),
    );
    expect(origin?.package).toBe('@prisma/client');
  });
});

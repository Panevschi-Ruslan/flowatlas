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

  it('says nothing about a receiver that is not a name and states no type', () => {
    expect(
      statedOrigin(
        receiverIn(`
          import { Kysely } from 'kysely';
          declare const of: any;
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

  /**
   * The same trace through a bare specifier the project's compiler options
   * place in the repository (P270): `src/generated/prisma/client` under
   * `baseUrl`, or an alias under `paths`.
   */
  const placedClientIn = (specifier: string, compilerOptions: { baseUrl: string; paths?: Record<string, string[]> }): TsNode => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions });
    project.getFileSystem().writeFileSync('/app/prisma/schema.prisma', SCHEMA.replace('./generated/prisma', '../src/generated/prisma'));
    project.createSourceFile(
      '/app/src/db.service.ts',
      `
        import { PrismaClient } from '${specifier}';
        export class DbService extends PrismaClient {}
      `,
    );
    const file = project.createSourceFile(
      '/app/src/orders.service.ts',
      `
        import { DbService } from './db.service';
        export class OrdersService {
          constructor(private readonly db: DbService) {}
          all() { return this.db.order.findMany(); }
        }
      `,
    );
    for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (Node.isPropertyAccessExpression(callee) && Node.isPropertyAccessExpression(callee.getExpression())) {
        return callee.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
      }
    }
    throw new Error('the source must hold a call through a delegate');
  };

  it('reads a generated client imported by the path baseUrl places it at', () => {
    const origin = statedOrigin(placedClientIn('src/generated/prisma/client', { baseUrl: '/app' }));
    expect(origin?.package).toBe('@prisma/client');
  });

  it('reads a generated client imported through a paths alias', () => {
    const origin = statedOrigin(
      placedClientIn('@db/client', { baseUrl: '/app', paths: { '@db/*': ['src/generated/prisma/*'] } }),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('reads a client kept by a function of the repository that writes its return type', () => {
    const origin = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        let shared: PrismaClient | undefined;
        function sharedClient(): PrismaClient {
          shared ??= new PrismaClient();
          return shared;
        }
        const loadClient = async (): Promise<PrismaClient> => sharedClient();
        export const all = async () => {
          const db = sharedClient();
          const later = await loadClient();
          return [db.order.findMany(), later.order.count()];
        };
      `),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('reads a client a method of the repository returns, held or called in place (P277)', () => {
    const held = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        class ClientFactory {
          private shared?: PrismaClient;
          client(): PrismaClient { return (this.shared ??= new PrismaClient()); }
        }
        export const all = (factory: ClientFactory) => {
          const db = factory.client();
          return db.order.findMany();
        };
      `),
    );
    expect(held?.package).toBe('@prisma/client');
    const inPlace = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        interface Registry { db(): Promise<PrismaClient>; }
        declare const registry: Registry;
        export const all = async () => (await registry.db()).order.findMany();
      `),
    );
    expect(inPlace?.package).toBe('@prisma/client');
  });

  it('reads a return type that is a type parameter as the type the call hands it (P277)', () => {
    const origin = statedOrigin(
      clientIn(`
        import { PrismaClient } from '@prisma/client';
        abstract class Base { protected pick<T>(): T { return undefined as T; } }
        export class Orders extends Base {
          all() {
            const db = this.pick<PrismaClient>();
            return db.order.findMany();
          }
        }
      `),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('does not read a method call whose method writes no return type (P277)', () => {
    expect(
      statedOrigin(
        clientIn(`
          import { PrismaClient } from '@prisma/client';
          class ClientFactory { client() { return new PrismaClient(); } }
          export const all = (factory: ClientFactory) => factory.client().order.findMany();
        `),
      ),
    ).toBeNull();
  });

  it('does not read a call of a function that writes no return type', () => {
    expect(
      statedOrigin(
        clientIn(`
          import { PrismaClient } from '@prisma/client';
          function sharedClient() { return new PrismaClient(); }
          export const all = () => {
            const db = sharedClient();
            return db.order.findMany();
          };
        `),
      ),
    ).toBeNull();
  });

  it('keeps a bare specifier a package where nothing the schema generates is under baseUrl', () => {
    const origin = statedOrigin(placedClientIn('src/zod/client', { baseUrl: '/app' }));
    expect(origin?.package).not.toBe('@prisma/client');
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

  const DB_MODULE = {
    '/db/index.ts': `
      import { PrismaClient } from '@prisma/client';
      export const db = new PrismaClient();
      export default db;
    `,
  };

  it('follows a client destructured from an import written as an expression', () => {
    const origin = statedOrigin(
      clientIn(
        `
          export const load = async () => {
            const { default: prisma } = await import('../db/index');
            return prisma.user.findMany();
          };
        `,
        DB_MODULE,
      ),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('takes a destructured name as the export it names', () => {
    const origin = statedOrigin(
      clientIn(
        `
          export const load = async () => {
            const { db: prisma } = await import('../db/index');
            return prisma.user.findMany();
          };
        `,
        DB_MODULE,
      ),
    );
    expect(origin?.package).toBe('@prisma/client');
  });

  it('does not read a destructured value that no import hands over', () => {
    const origin = statedOrigin(
      clientIn(
        `
          export const load = async (holder: any) => {
            const { default: prisma } = await holder.load('../db/index');
            return prisma.user.findMany();
          };
        `,
        DB_MODULE,
      ),
    );
    expect(origin).toBeNull();
  });
});

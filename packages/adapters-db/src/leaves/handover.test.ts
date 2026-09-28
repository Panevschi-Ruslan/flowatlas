import { Node, Project, SyntaxKind, type Node as TsNode } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { dbAdapters, handedOverIn, handovers, type Handover } from '../descriptors/index.js';
import { handedOver, unconfirmedHandover } from './handover.js';

/**
 * What the method call named `method` was made on.
 *
 * Nothing is installed in this project, which is the state the reading exists
 * for: `@mikro-orm/postgresql` resolves to nothing, and the checker cannot say
 * what any receiver below is.
 */
const receiverOf = (source: string, method: string): TsNode => {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile('/base.ts', 'export abstract class Base { getActiveManager<T>(): T { return undefined as T; } }');
  const file = project.createSourceFile('/a.ts', source);
  for (const call of file.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === method) {
      return callee.getExpression();
    }
  }
  throw new Error(`the source must call .${method}()`);
};

const IMPORTS = `
  import type { SqlEntityManager } from '@mikro-orm/postgresql';
  import { Base } from './base.js';
`;

const yielded = (source: string, method: string): string | undefined =>
  handedOver(receiverOf(source, method), handovers)?.yields.package;

describe('a data layer handed over by a described call', () => {
  it('reads a builder taken off a manager the type argument names', () => {
    const source = `${IMPORTS}
      class Repo extends Base {
        go() {
          return this.getActiveManager<SqlEntityManager>().getKnex()({ il: 'inventory_level' }).select('id').where('a', 1);
        }
      }`;
    expect(yielded(source, 'select')).toBe('knex');
    expect(yielded(source, 'where')).toBe('knex');
  });

  it('follows an unannotated variable to the call that made it', () => {
    const source = `${IMPORTS}
      class Repo extends Base {
        go() {
          const manager = this.getActiveManager<SqlEntityManager>();
          const knex = manager.getKnex();
          return knex('inventory_level').select('id');
        }
      }`;
    expect(yielded(source, 'select')).toBe('knex');
  });

  it('reads either side of a fallback', () => {
    const source = `${IMPORTS}
      class Repo extends Base {
        go() {
          const manager = this.getActiveManager<SqlEntityManager>();
          const knex = manager.getTransactionContext() ?? manager.getKnex();
          return knex.select('id').from('reservation').first();
        }
      }`;
    expect(yielded(source, 'first')).toBe('knex');
  });

  it('reads a manager the constructor was handed by its annotation', () => {
    const source = `${IMPORTS}
      class Repo {
        constructor(private readonly em: SqlEntityManager) {}
        go() { return this.em.getKnex()('inventory_level').update({ a: 1 }); }
      }`;
    expect(yielded(source, 'update')).toBe('knex');
  });

  it('reads a manager cast out of a context', () => {
    const source = `${IMPORTS}
      export const optionIds = (context: { manager?: unknown; tx?: unknown }) => {
        const manager = (context.tx ?? context.manager) as SqlEntityManager;
        const knex = manager.getKnex();
        return knex.select('id').from('product_option_value');
      };`;
    expect(yielded(source, 'from')).toBe('knex');
  });

  it('reads a framework path that re-exports the manager, and no other path of it', () => {
    const through = (module: string) => `
      import { SqlEntityManager } from '${module}';
      import { Base } from './base.js';
      class Repo extends Base {
        go() { return this.getActiveManager<SqlEntityManager>().getKnex()('t').select('id'); }
      }`;
    expect(yielded(through('@medusajs/framework/mikro-orm/postgresql'), 'select')).toBe('knex');
    // The framework's own helpers are the same package and hold no manager.
    expect(yielded(through('@medusajs/framework/utils'), 'select')).toBeUndefined();
  });

  it('says nothing when the method is called on something nobody described', () => {
    const source = `
      import type { Pool } from './pool.js';
      import { Base } from './base.js';
      class Repo extends Base {
        go() { return this.getActiveManager<Pool>().getKnex()('t').select('id'); }
      }`;
    expect(yielded(source, 'select')).toBeUndefined();
  });

  it('says nothing about a described holder whose method hands nothing over', () => {
    const source = `${IMPORTS}
      class Repo extends Base {
        go() { return this.getActiveManager<SqlEntityManager>().find('t').select('id'); }
      }`;
    expect(yielded(source, 'select')).toBeUndefined();
  });

  it('stops at what a query resolves to, which is rows rather than the builder', () => {
    const source = `${IMPORTS}
      class Repo extends Base {
        async go() {
          const rows = await this.getActiveManager<SqlEntityManager>().getKnex()('t').select('id');
          return rows.map((row) => row);
        }
      }`;
    expect(yielded(source, 'map')).toBeUndefined();
  });

  it('does not follow a variable that states its own type', () => {
    // An annotation is the stated reading's to answer; following the initialiser
    // past it would be a second answer to the same question.
    const source = `${IMPORTS}
      import type { Pool } from './pool.js';
      class Repo extends Base {
        go() {
          const knex: Pool = this.getActiveManager<SqlEntityManager>().getKnex();
          return knex.select('id');
        }
      }`;
    expect(yielded(source, 'select')).toBeUndefined();
  });

  it('asks nothing when nothing is described', () => {
    const none: readonly Handover[] = [];
    const receiver = receiverOf(
      `${IMPORTS} class Repo extends Base { go() { return this.getActiveManager<SqlEntityManager>().getKnex()('t').select('id'); } }`,
      'select',
    );
    expect(handedOver(receiver, none)).toBeUndefined();
  });
});

/**
 * A described method called on something whose type the source erased (R163).
 *
 * Not read - `any` may be the manager and may be anything with a method of that
 * name - and not silent either: the handover is reported as unconfirmed, which
 * is what the row a reader acts on is written from.
 */
describe('a handover whose holder states no type', () => {
  const unconfirmed = (source: string, method: string): string | undefined =>
    unconfirmedHandover(receiverOf(source, method), handovers)?.method;

  const ERASED = `${IMPORTS}
    export const optionValues = (context: { manager?: unknown }, ids: string[]) => {
      const manager = context.manager as any;
      const knex = manager.getTransactionContext() ?? manager.getKnex();
      return knex('product_option_value').select('id').whereIn('option_id', ids);
    };`;

  it('is not read as the library the handover yields', () => {
    expect(yielded(ERASED, 'select')).toBeUndefined();
  });

  it('is reported as the described method it reached', () => {
    expect(unconfirmed(ERASED, 'select')).toBe('getKnex');
  });

  it('is not reported when the holder states some other type', () => {
    const source = `
      import type { Pool } from './pool.js';
      export const go = (pool: Pool) => pool.getKnex()('t').select('id');`;
    expect(unconfirmed(source, 'select')).toBeUndefined();
  });

  it('is not reported when either side of a fallback is confirmed', () => {
    const source = `${IMPORTS}
      export const go = (context: { manager?: unknown }, typed: SqlEntityManager) => {
        const knex = (context.manager as any).getKnex() ?? typed.getKnex();
        return knex('t').select('id');
      };`;
    expect(unconfirmed(source, 'select')).toBeUndefined();
    expect(yielded(source, 'select')).toBe('knex');
  });
});

describe('reading knex in a project that reaches it through its ORM', () => {
  const knexAdapter = dbAdapters.find((adapter) => adapter.name === 'knex')!;

  it('makes knex readable for a manifest that names only the ORM', () => {
    expect([...handedOverIn({ dependencies: { '@mikro-orm/postgresql': '^6.0.0' } })]).toEqual([
      'knex',
    ]);
  });

  it('makes knex readable for a manifest that names a framework re-exporting the ORM', () => {
    expect([...handedOverIn({ dependencies: { '@medusajs/framework': '2.0.0' } })]).toEqual([
      'knex',
    ]);
  });

  it('makes nothing readable for a manifest that names neither', () => {
    expect(handedOverIn({ dependencies: { '@mikro-orm/mongodb': '^6.0.0' } }).size).toBe(0);
  });

  it('does not say knex applies to a project that only holds its ORM', () => {
    // Detection would carry a row saying the knex reader found nothing in every
    // such project that never calls `getKnex()`.
    expect(knexAdapter.detect({ dependencies: { '@medusajs/framework': '2.0.0' } })).toBe(false);
  });
});

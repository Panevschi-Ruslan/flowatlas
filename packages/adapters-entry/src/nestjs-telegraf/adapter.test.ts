import {
  GraphBuilder,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { nestjsTelegrafAdapter } from './index.js';

const LIBRARY = `
export type Trigger = string | RegExp;
export declare const Update: () => ClassDecorator;
export declare const Scene: (id: string) => ClassDecorator;
export declare const Wizard: (id: string) => ClassDecorator;
export declare const Action: (triggers: Trigger | Trigger[]) => MethodDecorator;
export declare const Command: (command: string | string[]) => MethodDecorator;
export declare const On: (updateTypes: string | string[]) => MethodDecorator;
export declare const SceneEnter: () => MethodDecorator;
export declare const WizardStep: (step: number) => MethodDecorator;
`;

const MARKERS = `export declare const FlowEntry: (name: string) => (...args: unknown[]) => void;`;

/** A context with nothing in it but the parsed sources an adapter reads. */
const contextOf = (source: string): ExtractContext => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { experimentalDecorators: true, strict: false },
  });
  project.createSourceFile('/node_modules/nestjs-telegraf/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/nestjs-telegraf/index.d.ts', LIBRARY);
  project.createSourceFile('/node_modules/@flowatlas/markers/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/@flowatlas/markers/index.d.ts', MARKERS);
  project.createSourceFile('/src/bot.ts', source);
  return {
    repo: 'bot',
    repoDir: '/',
    service: { name: 'bot', repo: '/', type: 'nestjs' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'bot' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

const extract = (source: string): { ctx: ExtractContext; entries: EntryNode[] } => {
  const ctx = contextOf(source);
  return { ctx, entries: nestjsTelegrafAdapter.extractEntries(ctx) };
};

const ids = (entries: readonly EntryNode[]): string[] => entries.map((entry) => entry.id).sort();

const reasons = (ctx: ExtractContext): string[] =>
  ctx.builder.unresolved.map((row) => row.reason).sort();

describe('recognising a bot', () => {
  it('needs the framework that declares the decorators, not the client library', () => {
    expect(nestjsTelegrafAdapter.detect({ dependencies: { 'nestjs-telegraf': '^2.9.1' } })).toBe(
      true,
    );
    expect(nestjsTelegrafAdapter.detect({ devDependencies: { 'nestjs-telegraf': '^2.9.1' } })).toBe(
      true,
    );
    expect(nestjsTelegrafAdapter.detect({ dependencies: { telegraf: '^4.16.3' } })).toBe(false);
  });
});

describe('turning bot handlers into entry points', () => {
  it('makes one entry per trigger, each handled by the method it was written on', () => {
    const { entries } = extract(`
      import { Command, Update } from 'nestjs-telegraf';
      @Update()
      export class OrdersUpdate {
        @Command(['orders', 'o']) list() {}
      }
    `);
    expect(ids(entries)).toEqual(['entry:bot:bot_command:o', 'entry:bot:bot_command:orders']);
    for (const entry of entries) {
      expect(entry.handler).toMatchObject({ className: 'OrdersUpdate', methodName: 'list' });
      expect(entry.meta).toMatchObject({ trigger: "['orders', 'o']", updateClass: 'OrdersUpdate' });
    }
  });

  it('reports a key built at run time instead of inventing one', () => {
    const { ctx, entries } = extract(`
      import { Action, Update } from 'nestjs-telegraf';
      const key = (): string => 'order_' + String(Date.now());
      @Update()
      export class OrdersUpdate {
        @Action(key()) retry() {}
      }
    `);
    expect(entries).toEqual([]);
    expect(ctx.builder.unresolved).toEqual([
      {
        file: 'src/bot.ts',
        line: 6,
        reason: 'dynamic-bot-trigger',
        hint: expect.stringContaining('@FlowEntry'),
        symbol: 'OrdersUpdate.retry',
        adapter: 'nestjs-telegraf',
      },
    ]);
  });

  it('takes the name from a marker when the trigger cannot be read', () => {
    const { ctx, entries } = extract(`
      import { FlowEntry } from '@flowatlas/markers';
      import { Action, Update } from 'nestjs-telegraf';
      const key = (): string => 'order_' + String(Date.now());
      @Update()
      export class OrdersUpdate {
        @Action(key())
        @FlowEntry('checkout')
        checkout() {}
      }
    `);
    expect(ids(entries)).toEqual(['entry:bot:bot_callback:checkout']);
    expect(entries[0]?.meta).toMatchObject({ trigger: 'key()', confidence: 'marker' });
    expect(ctx.builder.unresolved).toEqual([]);
  });

  it('keeps two scenes apart by prefixing what is declared inside them', () => {
    const { entries } = extract(`
      import { On, Scene } from 'nestjs-telegraf';
      @Scene('checkout')
      export class CheckoutScene {
        @On('text') address() {}
      }
      @Scene('feedback')
      export class FeedbackScene {
        @On('text') comment() {}
      }
    `);
    expect(ids(entries)).toEqual([
      'entry:bot:bot_event:checkout/text',
      'entry:bot:bot_event:feedback/text',
    ]);
  });

  it('chains the steps of a wizard in the order they are numbered', () => {
    const { ctx } = extract(`
      import { Wizard, WizardStep } from 'nestjs-telegraf';
      @Wizard('register')
      export class RegisterWizard {
        @WizardStep(4) done() {}
        @WizardStep(1) askName() {}
      }
    `);
    expect(ctx.builder.edges).toEqual([
      {
        from: 'entry:bot:scene_step:register#1',
        to: 'entry:bot:scene_step:register#4',
        type: 'triggers',
        confidence: 'static',
        file: 'src/bot.ts',
        line: 6,
        meta: { order: 1 },
      },
    ]);
  });

  it('reports two steps that claim the same number', () => {
    const { ctx, entries } = extract(`
      import { Wizard, WizardStep } from 'nestjs-telegraf';
      @Wizard('register')
      export class RegisterWizard {
        @WizardStep(1) askName() {}
        @WizardStep(1) askAgain() {}
      }
    `);
    expect(ids(entries)).toEqual(['entry:bot:scene_step:register#1']);
    expect(ctx.builder.unresolved).toEqual([
      {
        file: 'src/bot.ts',
        line: 6,
        reason: 'wizard-step-conflict',
        hint: 'Two @WizardStep with the same index in RegisterWizard; renumber.',
        symbol: 'RegisterWizard.askAgain',
        adapter: 'nestjs-telegraf',
      },
    ]);
  });

  it('reports a scene handler that sits outside any scene', () => {
    const { ctx, entries } = extract(`
      import { SceneEnter, Update } from 'nestjs-telegraf';
      export class NotificationsService {
        @SceneEnter() strayed() {}
      }
      @Update()
      export class OrdersUpdate {
        @SceneEnter() alsoStrayed() {}
      }
    `);
    expect(entries).toEqual([]);
    expect(reasons(ctx)).toEqual(['orphan-scene-decorator', 'orphan-scene-decorator']);
  });

  it('reports a handler in a class the framework never scans', () => {
    const { ctx, entries } = extract(`
      import { Command } from 'nestjs-telegraf';
      export class OrdersUpdate {
        @Command('menu') menu() {}
      }
    `);
    expect(entries).toEqual([]);
    expect(reasons(ctx)).toEqual(['orphan-update-decorator']);
  });

  it('reports a scene whose id is not written down, rather than keying on a hole', () => {
    const { ctx, entries } = extract(`
      import { On, Scene } from 'nestjs-telegraf';
      const id = (): string => 'checkout';
      @Scene(id())
      export class CheckoutScene {
        @On('text') address() {}
      }
    `);
    expect(entries).toEqual([]);
    expect(reasons(ctx)).toEqual(['dynamic-bot-trigger']);
  });

  it('says nothing about a same-named decorator from another library', () => {
    const { ctx, entries } = extract(`
      import { Update } from 'nestjs-telegraf';
      const Action = (event: string): MethodDecorator => () => undefined;
      @Update()
      export class OrdersUpdate {
        @Action('order.created') project() {}
      }
    `);
    expect(entries).toEqual([]);
    expect(ctx.builder.unresolved).toEqual([]);
  });
});

import {
  GraphBuilder,
  isFunctionHandler,
  isInlineHandler,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { nestjsTelegrafAdapter } from './nestjs-telegraf/index.js';
import { telegrafCallsAdapter } from './telegraf-calls.js';

const TELEGRAF = `
export declare class Telegraf {
  command(trigger: string | string[], handler: (ctx: unknown) => unknown): void;
  action(trigger: string | RegExp, handler: (ctx: unknown) => unknown): void;
  on(update: string, handler: (ctx: any) => unknown): void;
}
`;

const NESTJS_TELEGRAF = `
export declare const Update: () => ClassDecorator;
export declare const On: (updateTypes: string | string[]) => MethodDecorator;
export declare const Ctx: () => ParameterDecorator;
`;

const contextOf = (source: string): ExtractContext => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true, strict: false } });
  project.createSourceFile('/node_modules/telegraf/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/telegraf/index.d.ts', TELEGRAF);
  project.createSourceFile('/node_modules/nestjs-telegraf/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/nestjs-telegraf/index.d.ts', NESTJS_TELEGRAF);
  project.createSourceFile('/src/bot.ts', `import { Telegraf } from 'telegraf';\nimport { Ctx, On, Update } from 'nestjs-telegraf';\n${source}`);
  return {
    repo: 'bot',
    repoDir: '/',
    service: { name: 'bot', repo: '/', type: 'nestjs' },
    config: parseConfig({}),
    pkg: { dependencies: { telegraf: '^4.0.0', 'nestjs-telegraf': '^2.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'bot' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

const ids = (entries: readonly EntryNode[]): string[] => entries.map((entry) => entry.id).sort();

const handlerName = (entry: EntryNode | undefined): string | undefined => {
  const handler = entry?.handler;
  if (handler === undefined) return undefined;
  if (isInlineHandler(handler)) return handler.label;
  return isFunctionHandler(handler) ? handler.functionName : handler.methodName;
};

/** The call written as `text` in the bot's file. */
const callAt = (ctx: ExtractContext, text: string) =>
  ctx.project.getSourceFileOrThrow('/src/bot.ts').getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => call.getExpression().getText() === text);

const LISTENER = (rest: string): string => `
  export class Bot {
    private bot = new Telegraf();
    private readonly buttonRoutes = [
      { prefix: 'set_status_', handler: (ctx: any, d: string) => this.handleStatus(ctx, d) },
      { prefix: 'view_order_', handler: this.showOrder.bind(this) },
    ];
    setup() {
      this.bot.on('callback_query', async (ctx: any) => {
        const data = ('data' in ctx.callbackQuery ? ctx.callbackQuery.data : '') || '';
        const route = this.buttonRoutes.find((r) => data.startsWith(r.prefix));
        if (route) await route.handler(ctx, data);
        ${rest}
      });
    }
    handleStatus(ctx: any, data: string) {}
    showOrder(ctx: any, data: string) {}
  }
`;

describe('a listener of every callback split by a table of prefixes (P399)', () => {
  it('opens a way in per prefix, handled by its element and taking the data it starts', () => {
    const ctx = contextOf(LISTENER(''));
    const entries = telegrafCallsAdapter.extractEntries(ctx);
    expect(ids(entries)).toEqual(['entry:bot:bot_callback:set_status_*', 'entry:bot:bot_callback:view_order_*']);
    const view = entries.find((entry) => entry.key === 'view_order_*');
    expect(handlerName(view)).toBe('showOrder');
    expect(handlerName(entries.find((entry) => entry.key === 'set_status_*'))).toBe('bot_callback set_status_*');
    expect(view?.meta).toMatchObject({
      handlerVia: 'table',
      selectedBy: 'prefix view_order_',
      registration: 'action',
      updateType: 'callback_query',
      callbackData: { regex: '^view_order_', flags: '' },
    });
    const site = callAt(ctx, 'route.handler');
    expect(site !== undefined && telegrafCallsAdapter.standsForCall?.(site) === true).toBe(true);
    // Nothing else is a call the ways in stand for.
    const other = callAt(ctx, 'data.startsWith');
    expect(other !== undefined && telegrafCallsAdapter.standsForCall?.(other) === true).toBe(false);
  });

  it('keeps the listener for what runs on every update, saying whether that reads the data', () => {
    const answered = telegrafCallsAdapter.extractEntries(contextOf(LISTENER('await ctx.answerCbQuery();')));
    expect(ids(answered)).toEqual(['entry:bot:bot_callback:set_status_*', 'entry:bot:bot_callback:view_order_*', 'entry:bot:bot_event:callback_query']);
    const kept = answered.find((entry) => entry.kind === 'bot_event');
    expect(kept?.meta?.['splitByTable']).toMatch(/^src\/bot\.ts:\d+$/);
    expect(kept?.meta?.['restReadsData']).toBeUndefined();
    const unmatched = telegrafCallsAdapter.extractEntries(contextOf(LISTENER("if (!route) await ctx.answerCbQuery('unknown ' + data);")));
    expect(unmatched.find((entry) => entry.kind === 'bot_event')?.meta?.['restReadsData']).toBe(true);
  });

  it('splits nothing where the selection is not by the update, or an element is not read', () => {
    const notTheUpdate = telegrafCallsAdapter.extractEntries(
      contextOf(`
        declare const role: string;
        export class Bot {
          private bot = new Telegraf();
          setup() {
            const routes = [{ prefix: 'a', handler: (ctx: any) => this.a(ctx) }];
            this.bot.on('callback_query', (ctx: any) => routes.find((r) => role.startsWith(r.prefix))?.handler(ctx));
          }
          a(ctx: any) {}
        }
      `),
    );
    expect(ids(notTheUpdate)).toEqual(['entry:bot:bot_event:callback_query']);
    const spread = telegrafCallsAdapter.extractEntries(
      contextOf(`
        declare const more: Array<{ prefix: string; handler: (ctx: any) => void }>;
        export class Bot {
          private bot = new Telegraf();
          setup() {
            const routes = [{ prefix: 'a', handler: (ctx: any) => this.a(ctx) }, ...more];
            this.bot.on('callback_query', (ctx: any) => routes.find((r) => ctx.callbackQuery.data.startsWith(r.prefix))?.handler(ctx));
          }
          a(ctx: any) {}
        }
      `),
    );
    expect(ids(spread)).toEqual(['entry:bot:bot_event:callback_query']);
  });

  it('opens text chosen by === as the commands hears would open, and a pattern as an action by it would', () => {
    const entries = telegrafCallsAdapter.extractEntries(
      contextOf(`
        export class Bot {
          private bot = new Telegraf();
          setup() {
            const commands = [{ text: 'stock', run: (ctx: any) => this.stock(ctx) }, { text: 'ping', run: (ctx: any) => this.ping(ctx) }];
            this.bot.on('text', (ctx: any) => {
              const text = ctx.message.text;
              for (const command of commands) if (command.text === text) return command.run(ctx);
            });
            const buttons = [{ pattern: /^pay:(\\d+)$/, run: (ctx: any) => this.pay(ctx) }];
            this.bot.on('callback_query', (ctx: any) => buttons.find((b) => b.pattern.test(ctx.callbackQuery.data))?.run(ctx));
          }
          stock(ctx: any) {}
          ping(ctx: any) {}
          pay(ctx: any) {}
        }
      `),
    );
    expect(ids(entries)).toEqual(['entry:bot:bot_callback:/^pay:(\\d+)$/', 'entry:bot:bot_command:ping', 'entry:bot:bot_command:stock']);
    expect(entries.filter((entry) => entry.kind === 'bot_command').every((entry) => entry.meta?.['registration'] === 'hears' && entry.meta?.['callbackData'] === undefined)).toBe(true);
    expect(entries.find((entry) => entry.kind === 'bot_callback')?.meta?.['callbackData']).toEqual({ regex: '^pay:(\\d+)$', flags: '' });
  });
});

describe('the same listener written as a decorated method (P399)', () => {
  it('opens a way in per prefix and stands for the call through the table', () => {
    const ctx = contextOf(`
      @Update()
      export class Buttons {
        private readonly routes = [
          { prefix: 'track_', run: (ctx: any) => this.track(ctx) },
          { prefix: 'cancel_', run: (ctx: any) => this.cancel(ctx) },
        ];
        @On('callback_query')
        async onButton(@Ctx() ctx: any) {
          const data: string = ctx.callbackQuery.data;
          const route = this.routes.find((each) => data.startsWith(each.prefix));
          await route?.run(ctx);
        }
        track(ctx: any) {}
        cancel(ctx: any) {}
      }
    `);
    const entries = nestjsTelegrafAdapter.extractEntries(ctx);
    expect(ids(entries)).toEqual(['entry:bot:bot_callback:cancel_*', 'entry:bot:bot_callback:track_*']);
    expect(entries.every((entry) => entry.meta?.['handlerVia'] === 'table' && entry.meta?.['updateClass'] === 'Buttons')).toBe(true);
    const site = callAt(ctx, 'route?.run');
    expect(site !== undefined && nestjsTelegrafAdapter.standsForCall?.(site) === true).toBe(true);
    expect(site !== undefined && telegrafCallsAdapter.standsForCall?.(site) === true).toBe(false);
  });
});

describe('a registration over a table stands for the call its handler makes (P399)', () => {
  it('says the element call in the registered handler is the ways in’s', () => {
    const ctx = contextOf(`
      export class Bot {
        private bot = new Telegraf();
        setup() {
          for (const command of [{ name: 'orders', run: (ctx: any) => this.orders(ctx) }]) this.bot.command(command.name, (ctx) => command.run(ctx));
        }
        orders(ctx: any) {}
      }
    `);
    const site = callAt(ctx, 'command.run');
    expect(site !== undefined && telegrafCallsAdapter.standsForCall?.(site) === true).toBe(true);
  });
});

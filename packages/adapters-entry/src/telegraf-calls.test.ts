import {
  GraphBuilder,
  isFunctionHandler,
  noAdapters,
  parseConfig,
  silentLogger,
  type EntryNode,
  type ExtractContext,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { telegrafCallsAdapter } from './telegraf-calls.js';

const LIBRARY = `
export declare class Telegraf {
  start(handler: (ctx: unknown) => unknown): void;
  help(handler: (ctx: unknown) => unknown): void;
  command(trigger: string | string[], handler: (ctx: unknown) => unknown): void;
  hears(trigger: string | RegExp, handler: (ctx: unknown) => unknown): void;
  action(trigger: string | RegExp, handler: (ctx: unknown) => unknown): void;
  on(update: string, handler: (ctx: unknown) => unknown): void;
  launch(): void;
}
`;

const contextOf = (source: string): ExtractContext => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { experimentalDecorators: true, strict: false },
  });
  project.createSourceFile('/node_modules/telegraf/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/telegraf/index.d.ts', LIBRARY);
  project.createSourceFile('/src/bot.ts', `import { Telegraf } from 'telegraf';\n${source}`);
  return {
    repo: 'bot',
    repoDir: '/',
    service: { name: 'bot', repo: '/', type: 'nestjs' },
    config: parseConfig({}),
    pkg: { dependencies: { telegraf: '^4.0.0' } },
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'bot' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
};

const extract = (source: string): { ctx: ExtractContext; entries: EntryNode[] } => {
  const ctx = contextOf(source);
  return { ctx, entries: telegrafCallsAdapter.extractEntries(ctx) };
};

const ids = (entries: readonly EntryNode[]): string[] => entries.map((entry) => entry.id).sort();

/** The name of whatever answers an entry, a method and a function alike. */
const handlerName = (entry: EntryNode | undefined): string | undefined => {
  const handler = entry?.handler;
  if (handler === undefined) return undefined;
  return isFunctionHandler(handler) ? handler.functionName : handler.methodName;
};

describe('a bot written against the library directly', () => {
  it('is recognised by the package it depends on', () => {
    expect(telegrafCallsAdapter.detect({ dependencies: { telegraf: '^4.0.0' } })).toBe(true);
    expect(telegrafCallsAdapter.detect({ dependencies: { express: '^4.0.0' } })).toBe(false);
  });

  it('turns each registration into a way in, named the way a person would', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() {
          this.bot.command('orders', (ctx) => this.showOrders(ctx));
          this.bot.action('confirm', (ctx) => this.confirm(ctx));
          this.bot.on('contact', (ctx) => this.readContact(ctx));
        }
        showOrders(ctx: unknown) {}
        confirm(ctx: unknown) {}
        readContact(ctx: unknown) {}
      }
    `);
    expect(ids(entries)).toEqual([
      'entry:bot:bot_callback:confirm',
      'entry:bot:bot_command:orders',
      'entry:bot:bot_event:contact',
    ]);
  });

  it('takes the command from the method when the method is the command', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() {
          this.bot.start((ctx) => this.welcome(ctx));
          this.bot.help((ctx) => this.showHelp(ctx));
        }
        welcome(ctx: unknown) {}
        showHelp(ctx: unknown) {}
      }
    `);
    expect(ids(entries)).toEqual(['entry:bot:bot_command:help', 'entry:bot:bot_command:start']);
  });

  it('points at the method the handler runs, when it runs exactly one', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.command('orders', (ctx) => this.showOrders(ctx)); }
        showOrders(ctx: unknown) {}
      }
    `);
    expect(handlerName(entries[0])).toBe('showOrders');
    expect(entries[0]?.meta?.['handlerVia']).toBe('call');
  });

  it('points at the registration when the handler runs several, and says so', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() {
          this.bot.on('text', async (ctx) => {
            await this.parse(ctx);
            await this.reply(ctx);
          });
        }
        parse(ctx: unknown) {}
        reply(ctx: unknown) {}
      }
    `);
    expect(handlerName(entries[0])).toBe('setup');
    expect(entries[0]?.meta?.['handlerVia']).toBe('registration');
  });

  it('keeps a pattern as written, since that is what the button carries', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.action(/^order_(\\d+)$/, (ctx) => this.open(ctx)); }
        open(ctx: unknown) {}
      }
    `);
    expect(entries[0]?.key).toBe('/^order_(\\d+)$/');
  });

  it('opens one way in per command in a list, all reaching the same handler', () => {
    // `/o` is typed as often as `/orders`. Keeping only the first said the
    // second did not exist, and said nothing about having dropped it (R02).
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.command(['orders', 'o'], (ctx) => this.show(ctx)); }
        show(ctx: unknown) {}
      }
    `);
    expect(entries.map((entry) => entry.key)).toEqual(['orders', 'o']);
    expect(new Set(entries.map(handlerName))).toEqual(new Set(['show']));
  });

  it('keeps the patterns of a mixed list as well as the words', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.action(['pay', /^pay_(\\d+)$/], (ctx) => this.pay(ctx)); }
        pay(ctx: unknown) {}
      }
    `);
    expect(entries.map((entry) => entry.key)).toEqual(['pay', '/^pay_(\\d+)$/']);
  });

  it('says so when one trigger of a list cannot be read, rather than keeping the rest', () => {
    const { ctx, entries } = extract(`
      const chosen: string = String(Math.random());
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.command(['orders', chosen], (ctx) => this.show(ctx)); }
        show(ctx: unknown) {}
      }
    `);
    expect(entries).toEqual([]);
    expect(ctx.builder.build().unresolved.map((row) => row.reason)).toEqual(['dynamic-bot-trigger']);
  });

  it('says nothing about a method of the same name on anything else', () => {
    const { ctx, entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        private emitter = { on(event: string, handler: () => void) {} };
        setup() {
          this.bot.command('orders', () => this.show());
          this.emitter.on('text', () => this.ignore());
        }
        show() {}
        ignore() {}
      }
    `);
    expect(ids(entries)).toEqual(['entry:bot:bot_command:orders']);
    expect(ctx.builder.unresolved).toEqual([]);
  });

  it('reports a trigger built at run time instead of inventing one', () => {
    const { ctx, entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup(name: string) { this.bot.command(name, (ctx) => this.show(ctx)); }
        show(ctx: unknown) {}
      }
    `);
    expect(entries).toEqual([]);
    expect(ctx.builder.unresolved.map((row) => row.reason)).toEqual(['dynamic-bot-trigger']);
  });

  it('records one entry when the same trigger is registered twice', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() {
          this.bot.command('orders', (ctx) => this.show(ctx));
          this.bot.command('orders', (ctx) => this.show(ctx));
        }
        show(ctx: unknown) {}
      }
    `);
    expect(entries).toHaveLength(1);
  });

  it('names the entry so a person can ask for it by trigger alone', () => {
    const { entries } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup() { this.bot.command('orders', (ctx) => this.show(ctx)); }
        show(ctx: unknown) {}
      }
    `);
    expect(entries[0]?.meta?.['key']).toBe('orders');
  });
});

describe('a bot that registers outside any class', () => {
  it('finds registrations written in a module-level function', () => {
    // Reading only classes lost every one of these, and said nothing (R12).
    const { entries } = extract(`
      export function registerMenu(bot: Telegraf) {
        bot.command('menu', () => showMenu());
        bot.action('back', () => { other(); });
      }
      export function showMenu() {}
      function other() {}
    `);
    expect(ids(entries)).toEqual(['entry:bot:bot_callback:back', 'entry:bot:bot_command:menu']);
  });

  it('points at the function the handler runs, when it runs exactly one', () => {
    const { entries } = extract(`
      export function registerMenu(bot: Telegraf) {
        bot.command('menu', () => showMenu());
      }
      export function showMenu() {}
    `);
    expect(handlerName(entries[0])).toBe('showMenu');
    expect(entries[0]?.meta?.['handlerVia']).toBe('call');
  });

  it('falls back to the function the registration is written in', () => {
    const { entries } = extract(`
      export function registerMenu(bot: Telegraf) {
        bot.action('back', () => { first(); second(); });
      }
      function first() {}
      function second() {}
    `);
    expect(handlerName(entries[0])).toBe('registerMenu');
    expect(entries[0]?.meta?.['handlerVia']).toBe('registration');
    expect(entries[0]?.meta?.['updateClass']).toBeUndefined();
  });
});

describe('a bot with no way in', () => {
  it('says so once, rather than reading as a bot without buttons', () => {
    const { ctx, entries } = extract(`
      export class Bot {
        private handlers = { register(key: string, fn: () => void) {} };
        setup() { this.handlers.register('confirm', () => this.confirm()); }
        confirm() {}
      }
    `);
    expect(entries).toEqual([]);
    const rows = ctx.builder.build().unresolved;
    expect(rows.map((row) => row.reason)).toEqual(['bot-handlers-not-found']);
    expect(rows[0]?.hint).toContain('adapters.entry.registries');
  });

  it('stays quiet about a bot whose every trigger is merely unreadable', () => {
    const { ctx } = extract(`
      export class Bot {
        private bot = new Telegraf();
        setup(name: string) { this.bot.command(name, () => this.show()); }
        show() {}
      }
    `);
    expect(ctx.builder.build().unresolved.map((row) => row.reason)).toEqual(['dynamic-bot-trigger']);
  });
});

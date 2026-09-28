import type { EntryAdapter, EntryHandler, EntryKind, EntryNode, ExtractContext } from '@flowatlas/core';
import { hasAnyDependency, makeEntryId, resolveTypeOrigin } from '@flowatlas/core';
import type { CallExpression, Node as TsNode } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { resolveTriggerArg } from './nestjs-telegraf/triggers.js';
import {
  enclosingClass,
  enclosingHandler,
  fileOfNode,
  handlerInside,
  inlineHandlerOf,
  repoSources,
} from './shared.js';

const ADAPTER = 'telegraf-calls';

/** The package whose type on the receiver is what makes a call a registration. */
const TELEGRAF = 'telegraf';

interface Registration {
  name: string;
  kind: EntryKind;
  /** The command, for a method whose own name is the command since it takes no trigger. */
  implied?: string;
}

/**
 * Registration methods, and the kind of way in each one opens.
 *
 * A bot written against the library directly installs its handlers by calling
 * these rather than by decorating a class, which is the older and still the more
 * common of the two styles.
 *
 * A `Map`, because it is asked about every method name in the repository and a
 * plain object answers `toString` or `__proto__` with the language's own value:
 * one `bot.toString()` gave an entry a function for its kind, the id threw, and
 * the whole repository read as nothing (R130).
 */
const REGISTRATIONS: ReadonlyMap<string, Registration> = new Map(
  (
    [
      { name: 'start', kind: 'bot_command', implied: 'start' },
      { name: 'help', kind: 'bot_command', implied: 'help' },
      { name: 'settings', kind: 'bot_command', implied: 'settings' },
      { name: 'command', kind: 'bot_command' },
      { name: 'hears', kind: 'bot_command' },
      { name: 'action', kind: 'bot_callback' },
      { name: 'inlineQuery', kind: 'bot_callback' },
      { name: 'on', kind: 'bot_event' },
    ] satisfies Registration[]
  ).map((registration) => [registration.name, registration]),
);

/**
 * The registration a call makes on a bot, or `undefined` when it makes none.
 *
 * The one place that decides it, read by the adapter and by the report of an
 * unreadable trigger alike, so the two cannot disagree about what counts.
 */
const registrationOf = (call: CallExpression): Registration | undefined => {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const registration = REGISTRATIONS.get(callee.getName());
  if (registration === undefined) return undefined;
  // The receiver's type is the only signal that separates a bot from any other
  // object with a method called `on`, which is a great many objects.
  if (resolveTypeOrigin(callee.getExpression())?.package !== TELEGRAF) return undefined;
  return registration;
};

/**
 * Every trigger a registration installs, as written.
 *
 * `bot.command(['orders', 'o'], h)` registers two commands and a person may type
 * either. Keeping only the first said the second did not exist, with nothing to
 * say anything had been dropped.
 *
 * A pattern keeps its source and flags, spelled the way the decorator adapter
 * spells it, so the same bot read either way lands on the same ids.
 */
const triggersOf = (argument: TsNode | undefined): string[] => {
  if (argument === undefined) return [];
  const resolved = resolveTriggerArg(argument);
  if (!resolved.resolved) return [];
  const keys: string[] = [];
  for (const trigger of resolved.triggers) {
    if (trigger.kind === 'regex') keys.push(`/${trigger.source}/${trigger.flags}`);
    else if (trigger.kind === 'text') keys.push(trigger.value);
  }
  return keys;
};

interface Site {
  method: string;
  kind: EntryKind;
  /** One per way in that this one registration opens. */
  keys: string[];
  /** Absent when neither the inline function nor what surrounds it has a name. */
  handler: EntryHandler | undefined;
  /** True when the handler is whatever the registration is written inside. */
  viaRegistration: boolean;
  /** True when the handler is the function written in the registration. */
  inline?: boolean;
  line: number;
  text: string;
  /** Class the registration is written in, when it is written in one. */
  updateClass?: string;
}

const siteOf = (call: CallExpression, ctx: ExtractContext): Site | null => {
  const registration = registrationOf(call);
  if (registration === undefined) return null;
  const { name, kind, implied } = registration;

  const args = call.getArguments();
  const keys = implied === undefined ? triggersOf(args[0]) : [implied];
  if (keys.length === 0) return null;

  const handlerArg = implied === undefined ? args[1] : args[0];
  const owner = enclosingClass(call);
  const behind = handlerInside(handlerArg, owner, ctx);
  // A function written in the registration that hands over to no one thing is
  // still the code the update runs, and is nearer the truth than whatever the
  // registration happens to be written inside.
  const inline =
    behind === undefined ? inlineHandlerOf(handlerArg, `${name} ${keys[0] ?? ''}`.trim(), ctx) : undefined;
  return {
    method: name,
    kind,
    keys,
    handler: behind ?? inline ?? enclosingHandler(call, ctx),
    viaRegistration: behind === undefined && inline === undefined,
    ...(inline === undefined ? {} : { inline: true }),
    line: call.getStartLineNumber(),
    text: (implied === undefined ? (args[0]?.getText() ?? '') : name).slice(0, 80),
    ...(owner === undefined ? {} : { updateClass: owner.getName() ?? '<anonymous>' }),
  };
};

/**
 * Ways into a bot written against the library directly.
 *
 * A command typed at a bot and a button pressed under a message are the first
 * hop of a flow exactly as a route is, so both are ordinary entry points with a
 * kind of their own and nothing downstream knows a bot was involved (I8).
 *
 * Every call in the repository is looked at, not only the ones inside a class.
 * A bot that hands its `Telegraf` to `registerMenuHandlers(bot)` registers just
 * as many buttons as one that does it in a method, and reading only classes lost
 * every one of them without saying so.
 */
export const telegrafCallsAdapter: EntryAdapter = {
  name: ADAPTER,
  // The bot library dispatches updates itself; no request pipeline wraps them.
  outsideApplication: true,
  detect: (pkg) => hasAnyDependency(pkg, [TELEGRAF]),
  extractEntries: (ctx: ExtractContext) => {
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    let registrations = 0;

    for (const sourceFile of repoSources(ctx)) {
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const site = siteOf(call, ctx);
        if (site === null) {
          if (reportUnreadable(ctx, call)) registrations += 1;
          continue;
        }
        registrations += 1;

        for (const key of site.keys) {
          const id = makeEntryId(ctx.repo, site.kind, key);
          if (seen.has(id)) continue;
          seen.add(id);

          entries.push({
            id,
            kind: site.kind,
            label: `${site.kind} ${key}`,
            key,
            ...(site.handler === undefined ? {} : { handler: site.handler }),
            file: fileOfNode(call, ctx),
            line: site.line,
            meta: {
              // How a person names this entry: `bot:orders`.
              key,
              adapter: ADAPTER,
              registration: site.method,
              trigger: site.text,
              ...(site.updateClass === undefined ? {} : { updateClass: site.updateClass }),
              // Said plainly, because a walk from this entry is only as narrow
              // as the answer to "which code does the handler run".
              handlerVia: site.viaRegistration ? 'registration' : site.inline === true ? 'inline' : 'call',
            },
          });
        }
      }
    }

    if (registrations === 0) reportNoHandlers(ctx);
    return entries;
  },
};

const DYNAMIC_HINT = 'Register with a string literal or a constant, so the command can be named.';

/**
 * A registration whose trigger cannot be read.
 *
 * Recorded rather than skipped: a bot with a command nobody can name is a gap
 * in the map, and inventing a name for it would be worse. Returns whether this
 * was a registration at all, so that a bot whose every trigger is computed does
 * not also read as a bot with no handlers.
 */
const reportUnreadable = (ctx: ExtractContext, call: CallExpression): boolean => {
  const registration = registrationOf(call);
  if (registration === undefined || registration.implied !== undefined) return false;
  if (triggersOf(call.getArguments()[0]).length > 0) return false;

  ctx.builder.addUnresolved({
    file: fileOfNode(call, ctx),
    line: call.getStartLineNumber(),
    reason: 'dynamic-bot-trigger',
    hint: DYNAMIC_HINT,
    symbol: call.getArguments()[0]?.getText().slice(0, 60) ?? registration.name,
    adapter: ADAPTER,
  });
  return true;
};

/**
 * A bot with no way in.
 *
 * The worst property of a bot this tool cannot read is not that its handlers are
 * missing but that nothing says so: the graph looks complete and the missing
 * layer has to be noticed by hand. One row, once, naming what was looked for.
 */
const reportNoHandlers = (ctx: ExtractContext): void => {
  ctx.builder.addUnresolved({
    file: 'package.json',
    line: 1,
    reason: 'bot-handlers-not-found',
    message: `${ctx.repo} depends on ${TELEGRAF} and registers no handler this can read.`,
    hint: `Handlers installed through a table of the project's own go under adapters.entry.registries; ones registered on a value whose type is not ${TELEGRAF} cannot be told from any other call.`,
    symbol: TELEGRAF,
    adapter: ADAPTER,
  });
};

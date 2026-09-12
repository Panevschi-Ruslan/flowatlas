import type {
  EntryKind,
  EntryNode,
  EntryAdapter,
  EntryRegistryConfig,
  ExtractContext,
} from '@flowatlas/core';
import { hasAnyDependency, makeEntryId, originOfValue } from '@flowatlas/core';
import type { Node as TsNode, SourceFile } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import { fileOfNode, handlerOfFunction, repoFunctionOf, repoSources } from './shared.js';

const ADAPTER = 'entry-registries';

/**
 * Libraries whose handlers are installed by calling something.
 *
 * A manifest is the only thing an adapter may detect on, and a table of
 * functions the project wrote itself appears in no manifest. This is the signal
 * that a repository installs its handlers by call rather than by decorator,
 * which is the family a hand-written registry belongs to. Anywhere else,
 * `adapters.force.entry` turns this adapter on.
 */
const REGISTERED_BY_CALL = ['telegraf'];

const CONFIGURE_HINT =
  'Name it under adapters.entry.registries so each registration becomes an entry point.';

const receiversOf = (registry: EntryRegistryConfig): readonly string[] =>
  typeof registry.receiver === 'string' ? [registry.receiver] : registry.receiver;

/** A call of the shape `<receiver>.<method>(...)`, which is all this reads. */
interface MemberCall {
  call: TsNode;
  receiver: TsNode;
  method: string;
  args: TsNode[];
}

const memberCallsIn = function* (sourceFile: SourceFile): Generator<MemberCall> {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    yield {
      call,
      receiver: callee.getExpression(),
      method: callee.getName(),
      args: call.getArguments(),
    };
  }
};

/** Whether an argument is a function, however it was written. */
const isFunctionArg = (argument: TsNode | undefined): boolean => {
  if (argument === undefined) return false;
  if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) return true;
  return repoFunctionOf(argument) !== undefined;
};

/**
 * Whether an object was declared in the repository being read.
 *
 * The type rather than the value, because that is what tells a table of
 * functions written here from a client of an installed library: `bot.command`
 * and `app.post` are the same shape and belong to somebody else's adapter.
 */
const typeDeclaredHere = (expr: TsNode): boolean => {
  const type = expr.getType();
  const declaration = (type.getSymbol() ?? type.getAliasSymbol())?.getDeclarations()[0];
  if (declaration === undefined) return false;
  const path = declaration.getSourceFile().getFilePath();
  return !path.includes('/node_modules/') && !/\/lib\.[^/]*\.d\.ts$/.test(path);
};

/** A receiver reached through `this` is a method of the class, not a registry. */
const throughThis = (expr: TsNode): boolean =>
  Node.isThisExpression(expr) ||
  (Node.isPropertyAccessExpression(expr) && Node.isThisExpression(expr.getExpression()));

/**
 * A call that looks like it installs a handler and nothing claimed.
 *
 * Deliberately narrow: a key written as a literal, a function beside it, and a
 * receiver whose type is declared here. On the two real bots this matches the
 * one hand-written registry and nothing else — the shape alone matches every
 * route and every event listener in the project.
 */
const looksLikeRegistration = (site: MemberCall): boolean =>
  site.args.length >= 2 &&
  Node.isStringLiteral(site.args[0] as TsNode) &&
  isFunctionArg(site.args[1]) &&
  !throughThis(site.receiver) &&
  typeDeclaredHere(site.receiver);

/** What was seen through one receiver nobody configured. */
interface Unclaimed {
  name: string;
  file: string;
  line: number;
  count: number;
}

interface Match {
  registry: EntryRegistryConfig;
  site: MemberCall;
}

const matchOf = (
  site: MemberCall,
  registries: readonly EntryRegistryConfig[],
): EntryRegistryConfig | undefined => {
  const text = site.receiver.getText();
  return registries.find(
    (registry) => registry.method === site.method && receiversOf(registry).includes(text),
  );
};

const entryOf = (ctx: ExtractContext, { registry, site }: Match): EntryNode | undefined => {
  const keyArg = site.args[registry.keyArg];
  const file = fileOfNode(site.call, ctx);
  const line = site.call.getStartLineNumber();

  if (keyArg === undefined || !Node.isStringLiteral(keyArg)) {
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'registry-key-dynamic',
      hint: `Register with a string literal so the way in can be named, or drop ${registry.name} from adapters.entry.registries.`,
      symbol: keyArg?.getText().slice(0, 60) ?? `${registry.name}.${registry.method}`,
      adapter: ADAPTER,
    });
    return undefined;
  }

  const key = keyArg.getLiteralValue();
  const kind: EntryKind = registry.kind;
  const fn = repoFunctionOf(site.args[registry.handlerArg]);

  if (fn === undefined) {
    // The way in is real whether or not the code behind it has a name, so the
    // node is made either way and the reason the flow stops here is written down
    // rather than left to be guessed at.
    ctx.builder.addUnresolved({
      file,
      line,
      reason: 'registry-handler-anonymous',
      hint: 'Give the handler a name and register that, so the code behind this can be pointed at.',
      symbol: `${registry.name}:${key}`,
      adapter: ADAPTER,
    });
  }

  return {
    id: makeEntryId(ctx.repo, kind, key),
    kind,
    label: `${kind} ${key}`,
    key,
    ...(fn === undefined ? {} : { handler: handlerOfFunction(fn, ctx) }),
    file,
    line,
    meta: {
      // How a person names this entry: `bot:confirm_cancel`.
      key,
      adapter: ADAPTER,
      registry: registry.name,
      registration: `${site.receiver.getText()}.${registry.method}`,
      ...(fn === undefined ? { handlerVia: 'anonymous' } : { handlerVia: 'function' }),
    },
  };
};

/**
 * A table of handlers nobody configured.
 *
 * The worst thing about a registry the tool does not know is not that its
 * handlers are missing; it is that nothing says they are missing. One row per
 * receiver, naming what was seen and how many times, so a person can decide
 * whether to configure it.
 */
const reportUnclaimed = (ctx: ExtractContext, unclaimed: Map<string, Unclaimed>): void => {
  for (const seen of unclaimed.values()) {
    ctx.builder.addUnresolved({
      file: seen.file,
      line: seen.line,
      reason: 'entry-registry-unconfigured',
      message: `${seen.count} handler${seen.count === 1 ? '' : 's'} registered through ${seen.name}, which nothing here understands.`,
      hint: CONFIGURE_HINT,
      symbol: seen.name,
      adapter: ADAPTER,
      meta: { registrations: seen.count },
    });
  }
};

/**
 * Ways into a repository that keeps its handlers in a table of its own.
 *
 * A bot whose buttons go through `callbackRegistry.register('confirm', fn)` has
 * no library for an adapter to recognise, so the project names the shape and
 * every registration becomes an ordinary entry point with a kind of its own —
 * nothing downstream knows a registry was involved (I8).
 */
export const entryRegistriesAdapter: EntryAdapter = {
  name: ADAPTER,
  detect: (pkg) => hasAnyDependency(pkg, REGISTERED_BY_CALL),
  extractEntries: (ctx: ExtractContext) => {
    const registries = ctx.config.adapters.entry.registries;
    const entries: EntryNode[] = [];
    const seen = new Set<string>();
    const unclaimed = new Map<string, Unclaimed>();

    for (const sourceFile of repoSources(ctx)) {
      for (const site of memberCallsIn(sourceFile)) {
        const registry = matchOf(site, registries);

        if (registry !== undefined) {
          // A name shared with an import from a package is a different object.
          if (originOfValue(site.receiver).kind !== 'local') continue;
          const entry = entryOf(ctx, { registry, site });
          if (entry === undefined || seen.has(entry.id)) continue;
          seen.add(entry.id);
          entries.push(entry);
          continue;
        }

        if (!looksLikeRegistration(site)) continue;
        const name = `${site.receiver.getText()}.${site.method}`;
        const already = unclaimed.get(name);
        if (already === undefined) {
          unclaimed.set(name, {
            name,
            file: fileOfNode(site.call, ctx),
            line: site.call.getStartLineNumber(),
            count: 1,
          });
        } else {
          already.count += 1;
        }
      }
    }

    // A registry named in the configuration that matched nothing here is not
    // reported: the same configuration covers every repository of a project and
    // most of them have no such table. A name that never matches shows up as an
    // unclaimed row against the receiver it should have named.
    reportUnclaimed(ctx, unclaimed);

    return entries;
  },
};

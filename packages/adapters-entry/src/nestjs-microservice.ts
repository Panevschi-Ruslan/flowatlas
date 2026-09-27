import type { EntryAdapter, EntryKind, EntryNode } from '@flowatlas/core';
import {
  decoratorArgs,
  findDecorators,
  hasAnyDependency,
  makeEntryId,
  stableKey,
} from '@flowatlas/core';
import { fileOfNode, handlerOf, repoClasses } from './shared.js';

const NEST_MICROSERVICES = ['@nestjs/microservices'] as const;

/**
 * Decorator to entry kind. An event is fire and forget; a message expects a reply.
 *
 * A `Map` so that the lookup is safe by construction rather than by the filter
 * in front of it: a name read from source is never asked of an object literal,
 * which answers `toString` with the language's own function (R130).
 */
const PATTERN_DECORATORS: ReadonlyMap<string, EntryKind> = new Map([
  ['EventPattern', 'event'],
  ['MessagePattern', 'rpc'],
]);

/**
 * Handlers bound to a message pattern.
 *
 * An object pattern is turned into a key with its properties sorted, so the same
 * pattern always produces the same id no matter how it was written.
 */
export const nestjsMicroserviceAdapter: EntryAdapter = {
  name: 'nestjs-microservice',
  detect: (pkg) => hasAnyDependency(pkg, ['@nestjs/microservices']),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];

    for (const declaration of repoClasses(ctx)) {
      const file = fileOfNode(declaration, ctx);
      for (const method of declaration.getMethods()) {
        for (const decorator of findDecorators(method, {
          names: [...PATTERN_DECORATORS.keys()],
          fromModules: NEST_MICROSERVICES,
        })) {
          const kind = PATTERN_DECORATORS.get(decorator.getName());
          if (kind === undefined) continue;
          const [patternArg, transportArg] = decoratorArgs(decorator);

          if (patternArg === undefined || !patternArg.resolved) {
            ctx.builder.addUnresolved({
              file,
              line: method.getStartLineNumber(),
              reason: 'decorator-arg-dynamic',
              hint: 'Use a literal or a const pattern; a computed one cannot be matched to a producer.',
              symbol: `${declaration.getName() ?? '<anonymous>'}.${method.getName()}`,
              adapter: 'nestjs-microservice',
            });
            continue;
          }

          // A string pattern is its own key. Quoting it would put punctuation
          // into the id that the producer side would have to reproduce exactly.
          const key =
            typeof patternArg.value === 'string' ? patternArg.value : stableKey(patternArg.value);
          entries.push({
            id: makeEntryId(ctx.repo, kind, key),
            kind,
            label: `${kind} ${key}`,
            key,
            handler: handlerOf(method, ctx),
            file,
            line: method.getStartLineNumber(),
            meta: {
              pattern: patternArg.value,
              ...(transportArg?.resolved === true ? { transport: transportArg.value } : {}),
            },
          });
        }
      }
    }
    return entries;
  },
};

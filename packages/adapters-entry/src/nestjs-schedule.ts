import type { EntryAdapter, EntryNode } from '@flowatlas/core';
import { hasAnyDependency, makeEntryId } from '@flowatlas/core';
import { decoratorArgs, decoratorName, findDecorators } from '@flowatlas/extractor-nestjs';
import { fileOfNode, handlerOf, repoClasses } from './shared.js';

const NEST_SCHEDULE = ['@nestjs/schedule'] as const;

const SCHEDULE_DECORATORS = ['Cron', 'Interval', 'Timeout'] as const;

/**
 * Scheduled work.
 *
 * A job that fires on a timer starts a flow exactly as a request does, so it is
 * an ordinary entry point. The key is the handler rather than the schedule,
 * because two jobs may share a schedule but never a handler.
 */
export const nestjsScheduleAdapter: EntryAdapter = {
  name: 'nestjs-schedule',
  detect: (pkg) => hasAnyDependency(pkg, ['@nestjs/schedule']),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];

    for (const declaration of repoClasses(ctx)) {
      const file = fileOfNode(declaration, ctx);
      const owner = declaration.getName() ?? '<anonymous>';
      for (const method of declaration.getMethods()) {
        for (const decorator of findDecorators(method, {
          names: [...SCHEDULE_DECORATORS],
          fromModules: NEST_SCHEDULE,
        })) {
          const name = decoratorName(decorator);
          const args = decoratorArgs(decorator);
          const meta: Record<string, unknown> = {};

          if (name === 'Cron') {
            const [expression, options] = args;
            if (expression === undefined || !expression.resolved) {
              ctx.builder.addUnresolved({
                file,
                line: method.getStartLineNumber(),
                reason: 'decorator-arg-dynamic',
                hint: 'Use a literal cron expression or a member of the framework enum.',
                symbol: `${owner}.${method.getName()}`,
                adapter: 'nestjs-schedule',
              });
              continue;
            }
            meta['expression'] = expression.value;
            if (options?.resolved === true && typeof options.value === 'object' && options.value !== null) {
              const jobName = (options.value as { name?: unknown }).name;
              if (typeof jobName === 'string') meta['name'] = jobName;
            }
          } else {
            // Both accept an optional leading name: (ms) or (name, ms).
            const numeric = args.find((value) => value.resolved && typeof value.value === 'number');
            const named = args.find((value) => value.resolved && typeof value.value === 'string');
            if (numeric === undefined || !numeric.resolved) {
              ctx.builder.addUnresolved({
                file,
                line: method.getStartLineNumber(),
                reason: 'decorator-arg-dynamic',
                hint: `Give @${name} a literal number of milliseconds.`,
                symbol: `${owner}.${method.getName()}`,
                adapter: 'nestjs-schedule',
              });
              continue;
            }
            meta[name === 'Interval' ? 'intervalMs' : 'timeoutMs'] = numeric.value;
            if (named?.resolved === true) meta['name'] = named.value;
          }

          const key = `${owner}.${method.getName()}`;
          entries.push({
            id: makeEntryId(ctx.repo, 'cron', key),
            kind: 'cron',
            label: `cron ${key}`,
            key,
            handler: handlerOf(method, ctx),
            file,
            line: method.getStartLineNumber(),
            meta: { ...meta, trigger: name },
          });
        }
      }
    }
    return entries;
  },
};

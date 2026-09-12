import type { EntryAdapter, EntryNode, ExtractContext } from '@flowatlas/core';
import { firstStringArg, getDecorator, hasAnyDependency, makeEntryId } from '@flowatlas/core';
import type { ClassDeclaration, MethodDeclaration } from 'ts-morph';
import { fileOfNode, handlerOf, repoClasses } from '../shared.js';
import { BOT_DECORATORS, BOT_KINDS, deriveKey, entryMeta, type BotDecorator } from './ids.js';
import { readBotClass, wizardChain, type StepSite } from './scenes.js';
import {
  resolveTriggerArg,
  stepTrigger,
  TELEGRAF_MODULE,
  telegrafDecoratorName,
  type BotTrigger,
} from './triggers.js';

const ADAPTER = 'nestjs-telegraf';

const MARKER_MODULES = ['@flowatlas/markers'] as const;

const DYNAMIC_HINT =
  "Use a string literal, a const from a shared package, or add @FlowEntry('<name>') to the handler.";
const ORPHAN_SCENE_HINT =
  '@SceneEnter/@SceneLeave/@WizardStep must sit in a class decorated with @Scene or @Wizard.';
const ORPHAN_UPDATE_HINT =
  '@Start/@Help/@Command/@Action/@On/@Hears must sit in a class decorated with @Update, @Scene or @Wizard.';

/** What every handler of one class shares. */
interface ClassScope {
  /** Repo-relative POSIX path of the class. */
  file: string;
  /** Class name, recorded on every entry as `meta.updateClass`. */
  owner: string;
  /** Scene or wizard id, empty for a plain `@Update` class. */
  scene: string;
}

interface HandlerSite {
  method: MethodDeclaration;
  decorator: BotDecorator;
  trigger: BotTrigger;
  /** The decorator argument as written, when there was one. */
  triggerText?: string;
  marker?: boolean;
}

const markerName = (method: MethodDeclaration): string | undefined => {
  const marker = getDecorator(method, 'FlowEntry', MARKER_MODULES);
  return marker === undefined ? undefined : firstStringArg(marker);
};

const entryOf = (ctx: ExtractContext, scope: ClassScope, site: HandlerSite): EntryNode => {
  const kind = BOT_KINDS[site.decorator];
  const key = deriveKey(site.decorator, site.trigger, scope.scene);
  return {
    id: makeEntryId(ctx.repo, kind, key),
    kind,
    label: `${kind} ${key}`,
    key,
    handler: handlerOf(site.method, ctx),
    file: scope.file,
    line: site.method.getStartLineNumber(),
    meta: {
      // The key is how a person names this entry: `bot:order_confirm`. Recorded
      // so a reference resolves to it without knowing the id grammar.
      key,
      ...entryMeta({
      decorator: site.decorator,
      trigger: site.trigger,
      scene: scope.scene,
      updateClass: scope.owner,
      ...(site.triggerText === undefined ? {} : { triggerText: site.triggerText }),
      ...(site.marker === true ? { marker: true } : {}),
      }),
    },
  };
};

/**
 * Handler decorators in a class the framework never scans.
 *
 * The handler is real and never runs, which is worth a line in the report: the
 * usual cause is a class that lost its `@Update` in a refactor.
 */
const reportStrays = (
  ctx: ExtractContext,
  declaration: ClassDeclaration,
  scope: ClassScope,
): void => {
  for (const method of declaration.getMethods()) {
    for (const decorator of method.getDecorators()) {
      const name = telegrafDecoratorName(decorator, BOT_DECORATORS);
      if (name === undefined) continue;
      const scene = BOT_KINDS[name] === 'scene_step';
      ctx.builder.addUnresolved({
        file: scope.file,
        line: method.getStartLineNumber(),
        reason: scene ? 'orphan-scene-decorator' : 'orphan-update-decorator',
        hint: scene ? ORPHAN_SCENE_HINT : ORPHAN_UPDATE_HINT,
        symbol: `${scope.owner}.${method.getName()}`,
        adapter: ADAPTER,
      });
    }
  }
};

/**
 * Every entry point one bot class declares.
 *
 * Wizard steps are collected rather than emitted as they are met, because which
 * of two handlers claiming step 3 is the real one, and which step each links to,
 * is only knowable once the whole class has been read.
 */
const classEntries = (
  ctx: ExtractContext,
  declaration: ClassDeclaration,
  scope: ClassScope,
): EntryNode[] => {
  const entries: EntryNode[] = [];
  const steps: Array<StepSite & { entry: EntryNode }> = [];

  for (const method of declaration.getMethods()) {
    const marker = markerName(method);

    for (const decorator of method.getDecorators()) {
      const name = telegrafDecoratorName(decorator, BOT_DECORATORS);
      if (name === undefined) continue;
      const line = method.getStartLineNumber();
      const symbol = `${scope.owner}.${method.getName()}`;
      const report = (reason: string, hint: string): void => {
        ctx.builder.addUnresolved({ file: scope.file, line, reason, hint, symbol, adapter: ADAPTER });
      };

      if (BOT_KINDS[name] === 'scene_step') {
        if (scope.scene === '') {
          report('orphan-scene-decorator', ORPHAN_SCENE_HINT);
          continue;
        }
        if (name !== 'WizardStep') {
          entries.push(entryOf(ctx, scope, { method, decorator: name, trigger: { kind: 'none' } }));
          continue;
        }
        const trigger = stepTrigger(decorator);
        if (trigger === undefined) {
          report('dynamic-bot-trigger', 'Give @WizardStep a literal step number.');
          continue;
        }
        const entry = entryOf(ctx, scope, { method, decorator: name, trigger });
        steps.push({ index: trigger.index, id: entry.id, file: scope.file, line, symbol, entry });
        continue;
      }

      // The two that take no argument register the command they are named after.
      if (name === 'Start' || name === 'Help') {
        entries.push(entryOf(ctx, scope, { method, decorator: name, trigger: { kind: 'none' } }));
        continue;
      }

      const [argument] = decorator.getArguments();
      const resolved = argument === undefined ? undefined : resolveTriggerArg(argument);

      if (resolved === undefined || !resolved.resolved) {
        if (marker === undefined) {
          report('dynamic-bot-trigger', DYNAMIC_HINT);
          continue;
        }
        entries.push(
          entryOf(ctx, scope, {
            method,
            decorator: name,
            trigger: { kind: 'text', value: marker },
            ...(resolved === undefined ? {} : { triggerText: resolved.text }),
            marker: true,
          }),
        );
        continue;
      }

      for (const trigger of resolved.triggers) {
        entries.push(
          entryOf(ctx, scope, {
            method,
            decorator: name,
            trigger,
            triggerText: argument?.getText() ?? '',
          }),
        );
      }
    }
  }

  const chain = wizardChain(steps);
  for (const step of chain.steps) entries.push(step.entry);
  for (const link of chain.edges) {
    ctx.builder.addEdge({
      from: link.from,
      to: link.to,
      type: 'triggers',
      confidence: 'static',
      file: scope.file,
      line: link.line,
      meta: { order: link.order },
    });
  }
  for (const clash of chain.conflicts) {
    ctx.builder.addUnresolved({
      file: clash.file,
      line: clash.line,
      reason: 'wizard-step-conflict',
      hint: `Two @WizardStep with the same index in ${scope.owner}; renumber.`,
      symbol: clash.symbol,
      adapter: ADAPTER,
    });
  }
  return entries;
};

/**
 * Bot handlers: commands, pressed buttons, updates and scene steps.
 *
 * A pressed inline button is the first hop of a flow exactly as a route is, so
 * everything here is an ordinary entry point with a kind of its own and nothing
 * downstream needs to know that a bot was involved (I8). The wizard is the one
 * shape with an order to it, and that order is drawn as `triggers` edges between
 * consecutive steps.
 */
export const nestjsTelegrafAdapter: EntryAdapter = {
  name: ADAPTER,
  // `telegraf` on its own means the imperative API, which registers handlers in
  // calls this adapter cannot see.
  detect: (pkg) => hasAnyDependency(pkg, [TELEGRAF_MODULE]),
  extractEntries: (ctx) => {
    const entries: EntryNode[] = [];

    for (const declaration of repoClasses(ctx)) {
      const bot = readBotClass(declaration);
      const scope: ClassScope = {
        file: fileOfNode(declaration, ctx),
        owner: declaration.getName() ?? '<anonymous>',
        scene: bot?.role === 'scene' ? bot.scene : '',
      };

      if (bot === undefined) {
        reportStrays(ctx, declaration, scope);
        continue;
      }
      if (bot.role === 'unnamed-scene') {
        ctx.builder.addUnresolved({
          file: scope.file,
          line: declaration.getStartLineNumber(),
          reason: 'dynamic-bot-trigger',
          hint: `Give @${bot.decorator} a literal id; every handler inside it is keyed by that id.`,
          symbol: scope.owner,
          adapter: ADAPTER,
        });
        continue;
      }

      entries.push(...classEntries(ctx, declaration, scope));
    }
    return entries;
  },
};

export { BOT_DECORATORS, BOT_KINDS, deriveKey, entryMeta } from './ids.js';
export type { BotDecorator, BotEntryMeta, CallbackData } from './ids.js';
export { readBotClass, wizardChain } from './scenes.js';
export type { BotClass, ChainLink, StepSite, WizardChain } from './scenes.js';
export {
  isTelegrafDecorator,
  resolveTriggerArg,
  stepTrigger,
  TELEGRAF_MODULE,
  telegrafDecoratorName,
} from './triggers.js';
export type { BotTrigger, TriggerArg } from './triggers.js';

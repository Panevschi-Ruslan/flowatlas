import {
  decoratorArgs,
  decoratorExportedName,
  decoratorModule,
  decoratorName,
  evaluateExpression,
} from '@flowatlas/core';
import type { Decorator, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/** The package a decorator must come from before it means anything here. */
export const TELEGRAF_MODULE = 'nestjs-telegraf';

/**
 * What a handler is registered under, as written at the registration site.
 *
 * A regular expression keeps its source and its flags instead of a compiled
 * value: the text is the only stable identity a button pressed at run time can
 * be matched back to (D3). `none` covers the decorators that take no argument,
 * where the decorator itself is the trigger.
 */
export type BotTrigger =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'regex'; readonly source: string; readonly flags: string }
  | { readonly kind: 'step'; readonly index: number }
  | { readonly kind: 'none' };

/**
 * One decorator argument, resolved into the triggers it registers.
 *
 * An array argument fans out into one trigger per element, because a handler
 * registered as `['help', 'h']` must be findable under either spelling (D4).
 */
export type TriggerArg =
  | { readonly resolved: true; readonly triggers: readonly BotTrigger[] }
  | { readonly resolved: false; readonly text: string };

/** `/source/flags`, with `s` so a pattern containing a newline still splits. */
const REGEX_LITERAL = /^\/(.*)\/([a-z]*)$/s;

const regexTrigger = (node: TsNode): BotTrigger | undefined => {
  if (!Node.isRegularExpressionLiteral(node)) return undefined;
  const match = REGEX_LITERAL.exec(node.getText());
  const [, source, flags] = match ?? [];
  return source === undefined ? undefined : { kind: 'regex', source, flags: flags ?? '' };
};

/** A trigger written as one value: a pattern, or anything that reads as a string. */
const singleTrigger = (node: TsNode): BotTrigger | undefined => {
  const pattern = regexTrigger(node);
  if (pattern !== undefined) return pattern;
  const value = evaluateExpression(node);
  return value.resolved && typeof value.value === 'string'
    ? { kind: 'text', value: value.value }
    : undefined;
};

const stringTriggers = (value: unknown): BotTrigger[] | undefined => {
  if (typeof value === 'string') return [{ kind: 'text', value }];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return (value as string[]).map((item) => ({ kind: 'text', value: item }));
  }
  return undefined;
};

/**
 * Reads the triggers a decorator argument registers, or says it cannot.
 *
 * The array literal is handled before anything else because a mixed list such
 * as `['pay', /^pay_/]` has no value the shared evaluator can produce, and
 * losing the literal half of it would be losing a real button.
 */
export const resolveTriggerArg = (argument: TsNode): TriggerArg => {
  const text = argument.getText();

  if (Node.isArrayLiteralExpression(argument)) {
    const triggers: BotTrigger[] = [];
    for (const element of argument.getElements()) {
      const trigger = singleTrigger(element);
      if (trigger === undefined) return { resolved: false, text };
      triggers.push(trigger);
    }
    return triggers.length === 0 ? { resolved: false, text } : { resolved: true, triggers };
  }

  const pattern = regexTrigger(argument);
  if (pattern !== undefined) return { resolved: true, triggers: [pattern] };

  const value = evaluateExpression(argument);
  const triggers = value.resolved ? stringTriggers(value.value) : undefined;
  return triggers === undefined ? { resolved: false, text } : { resolved: true, triggers };
};

export type StepTrigger = Extract<BotTrigger, { kind: 'step' }>;

/** The step number of `@WizardStep(n)`, when it is written as a number. */
export const stepTrigger = (decorator: Decorator): StepTrigger | undefined => {
  const [first] = decoratorArgs(decorator);
  return first !== undefined && first.resolved && typeof first.value === 'number'
    ? { kind: 'step', index: first.value }
    : undefined;
};

/**
 * The library name of a decorator, or undefined when it is not one of `names`
 * as exported by the bot framework.
 *
 * Matching on the written name alone would turn a same-named decorator from
 * another library into a bot entry point that does not exist, so the decorator
 * is resolved to its declaration first; an alias is still the same decorator
 * and matches on the name it is exported under (D7).
 *
 * An origin that cannot be read is a no here, unlike in the shared matcher:
 * `@Action`, `@Command` and `@On` are ordinary names in projects that have
 * nothing to do with a bot, and a phantom entry point is worse than a handler
 * missed behind a wrapper module.
 */
export const telegrafDecoratorName = <N extends string>(
  decorator: Decorator,
  names: readonly N[],
): N | undefined => {
  const written = decoratorName(decorator);
  let name = names.find((candidate) => candidate === written);
  if (name === undefined) {
    const exported = decoratorExportedName(decorator);
    name = names.find((candidate) => candidate === exported);
  }
  if (name === undefined) return undefined;
  return decoratorModule(decorator) === TELEGRAF_MODULE ? name : undefined;
};

/** The first decorator on a node that the bot framework exports under one of `names`. */
export const findTelegrafDecorator = <N extends string>(
  node: { getDecorators(): Decorator[] },
  names: readonly N[],
): { decorator: Decorator; name: N } | undefined => {
  for (const decorator of node.getDecorators()) {
    const name = telegrafDecoratorName(decorator, names);
    if (name !== undefined) return { decorator, name };
  }
  return undefined;
};

export const isTelegrafDecorator = (decorator: Decorator, names: readonly string[]): boolean =>
  telegrafDecoratorName(decorator, names) !== undefined;

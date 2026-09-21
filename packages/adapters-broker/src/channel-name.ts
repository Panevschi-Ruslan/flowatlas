import {
  foldedChoices,
  MOST_CHOICES,
  packageNameOf,
  type FlowatlasConfig,
} from '@flowatlas/core';
import { evaluateExpression, stableKey } from '@flowatlas/extractor-nestjs';
import type { Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';

/** How a channel name was arrived at. */
export type ChannelVia = 'literal' | 'const' | 'enum' | 'shared-package' | 'pattern' | 'template';

export interface ResolvedChannel {
  /** The representative name: the sole one, or the pattern the set shares. */
  readonly name: string;
  /**
   * Every channel this address reaches. One entry for an ordinary name; several
   * when a hole holds a closed set of values and each one is a real channel
   * (R42). Always non-empty, so a reader can iterate it without a fallback.
   */
  readonly names: readonly string[];
  readonly via: ChannelVia;
}

export interface UnresolvedChannel {
  readonly unresolved: 'channel-from-config' | 'channel-dynamic' | 'channel-const-unresolved';
  readonly text: string;
}

export type ChannelResolution = ResolvedChannel | UnresolvedChannel;

const CONFIG_METHODS = new Set(['get', 'getOrThrow', 'require']);

/** A read of a settings value, which is a name only known once the app runs. */
const isConfigRead = (node: TsNode): boolean => {
  if (!Node.isCallExpression(node)) return false;
  const callee = node.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (!CONFIG_METHODS.has(callee.getName())) return false;
  const receiver = callee.getExpression().getText().split('.').pop() ?? '';
  return /config(service)?$/i.test(receiver) || /env$/i.test(receiver);
};

const declarationOf = (node: TsNode): TsNode | undefined => {
  if (!Node.isIdentifier(node) && !Node.isPropertyAccessExpression(node)) return undefined;
  const symbol = node.getSymbol();
  if (symbol === undefined) return undefined;
  return (symbol.getAliasedSymbol() ?? symbol).getDeclarations()[0];
};

/** Which shared package a declaration came from, when it came from one. */
const sharedPackageOf = (
  declaration: TsNode | undefined,
  sharedPackages: readonly string[],
): string | undefined => {
  if (declaration === undefined) return undefined;
  const path = declaration.getSourceFile().getFilePath();
  // The manifest is the reliable answer, because a workspace reaches its own
  // packages through a link. The path is the fallback for anything installed
  // the ordinary way, where no manifest is reachable.
  const owner = packageNameOf(path);
  return (
    sharedPackages.find((pkg) => pkg === owner) ??
    sharedPackages.find((pkg) => path.includes(`/node_modules/${pkg}/`))
  );
};

/**
 * The most channels one address may name before the set stops being useful.
 *
 * The same judgement core makes about how many values a hole may stand for, so
 * it is the same number and not a second copy of it (R42).
 */
const MOST_NAMES = MOST_CHOICES;

/**
 * What each hole of a template can hold, in order.
 *
 * The one string the hole evaluates to, then the closed set the code states —
 * a union in the type of whatever fills it, or a value folded from one through
 * plain string work. A hole neither can settle stays a hole and reads as `*`.
 *
 * There is deliberately no third source. An annotation was built for this and
 * removed before it shipped: every hole it could have named can be named in
 * the type instead, which the compiler checks, which renames with its members,
 * and which cannot drift from the code because it is the code. A mechanism for
 * accepting an unverifiable claim, where a checked way of saying the same
 * thing exists, is the one thing this tool should not offer (R42).
 */
const holeValuesOf = (template: TsNode): (string[] | undefined)[] => {
  if (!Node.isTemplateExpression(template)) return [];
  return template.getTemplateSpans().map((span) => {
    const expression = span.getExpression();
    const value = evaluateExpression(expression);
    if (value.resolved && typeof value.value === 'string') return [value.value];
    return foldedChoices(expression, MOST_NAMES) ?? undefined;
  });
};

/** The template read as one name, every hole a `*`. */
const patternOf = (template: TsNode): string => {
  if (!Node.isTemplateExpression(template)) return '*';
  const head = template.getHead().getLiteralText();
  return (
    head +
    template
      .getTemplateSpans()
      .map((span) => {
        const value = evaluateExpression(span.getExpression());
        const piece = value.resolved && typeof value.value === 'string' ? value.value : '*';
        return piece + span.getLiteral().getLiteralText();
      })
      .join('')
  );
};

/**
 * Works out which channel a call is addressed to.
 *
 * In order: a literal, then a constant or enum member the checker can follow
 * (including into a package the project shares between services), then a
 * settings lookup, then anything else. Only the first two produce a channel
 * node; the rest produce a producer with no channel and a row saying which
 * annotation would fix it. A guessed channel name would silently join two
 * services that never talk to each other.
 */
export const resolveChannelName = (
  expr: TsNode,
  config: Pick<FlowatlasConfig, 'sharedPackages'>,
): ChannelResolution => {
  const text = expr.getText();

  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    const literal = expr.getLiteralValue();
    return { name: literal, names: [literal], via: 'literal' };
  }

  if (isConfigRead(expr)) return { unresolved: 'channel-from-config', text };

  // A channel addressed per entity is written as a template. The family it
  // belongs to is fixed even though the instance is not, and the family is what
  // a producer in one service and a handler in another have in common.
  if (Node.isTemplateExpression(expr)) {
    const head = expr.getHead().getLiteralText();
    // Each hole contributes either the one string it reads as, the closed set
    // of strings it can hold, or `*`. A hole with a set multiplies the names
    // this address reaches; `holes` is what the annotation may narrow.
    const holes = holeValuesOf(expr);
    let names: string[] | undefined = [head];
    for (const [index, span] of expr.getTemplateSpans().entries()) {
      const tail = span.getLiteral().getLiteralText();
      const pieces = holes[index] ?? ['*'];
      if (names === undefined || names.length * pieces.length > MOST_NAMES) {
        // More combinations than are worth listing. Keeping the first prefix
        // and dropping the rest would assert one family and hide the others —
        // `${a}.${b}` over two values of `a` became `one.*` alone, and the
        // edge said so. The whole address goes back to being a pattern.
        names = undefined;
        continue;
      }
      names = names.flatMap((prefix) => pieces.map((piece) => prefix + piece + tail));
    }
    // Two holes can produce the same address twice; one address said twice is
    // still one address.
    if (names !== undefined) names = [...new Set(names)];
    const pattern = names !== undefined && names.length === 1 ? (names[0] as string) : patternOf(expr);
    // Nothing but holes names nothing.
    if (pattern.replace(/[*]/g, '').trim() === '') return { unresolved: 'channel-dynamic', text };
    const reached = names ?? [pattern];
    return {
      name: pattern,
      names: reached,
      via: reached.some((each) => each.includes('*')) ? 'template' : 'literal',
    };
  }

  const value = evaluateExpression(expr);
  if (value.resolved) {
    if (typeof value.value === 'string') {
      const declaration = declarationOf(expr);
      const shared = sharedPackageOf(declaration, config.sharedPackages);
      const name = value.value;
      if (shared !== undefined) return { name, names: [name], via: 'shared-package' };
      if (declaration !== undefined && Node.isEnumMember(declaration)) {
        return { name, names: [name], via: 'enum' };
      }
      return { name, names: [name], via: 'const' };
    }
    // A list of names is several channels, not one pattern: a catalogue kept in
    // a shared package hands the whole family over at once (R40).
    if (Array.isArray(value.value) && value.value.every((each) => typeof each === 'string')) {
      const names = [...new Set(value.value as string[])];
      if (names.length > 0 && names.length <= MOST_NAMES) {
        const declaration = declarationOf(expr);
        const shared = sharedPackageOf(declaration, config.sharedPackages);
        return {
          name: names[0] as string,
          names,
          via: shared !== undefined ? 'shared-package' : 'const',
        };
      }
      // A catalogue wider than the cap is still a list of channels, and it is
      // emphatically not an object pattern: falling through to the branch
      // below wrote the whole array out as one channel's name.
      return { unresolved: 'channel-dynamic', text };
    }
    if (typeof value.value === 'object' && value.value !== null) {
      // An object pattern addresses a channel too; its stable text is the name.
      const key = stableKey(value.value);
      return { name: key, names: [key], via: 'pattern' };
    }
  }

  // An identifier that names something the checker could not follow is worth
  // telling apart from an expression that was never going to be constant.
  if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr)) {
    return { unresolved: 'channel-const-unresolved', text };
  }
  return { unresolved: 'channel-dynamic', text };
};

export const isResolved = (resolution: ChannelResolution): resolution is ResolvedChannel =>
  'name' in resolution;

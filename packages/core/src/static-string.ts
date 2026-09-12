import type { Node as TsNode, TemplateExpression } from 'ts-morph';
import { Node } from 'ts-morph';
import { holeIn, UNREAD_SPAN } from './ids.js';
import { packageNameOf } from './origin.js';
import { declarationOf, evaluateExpression } from './static-value.js';
import { choosesASegment } from './trace.js';

/** How a string was arrived at, which is what tells a reader how far to trust it. */
export type StaticStringVia = 'literal' | 'template' | 'const' | 'enum' | 'shared-package';

export interface StaticString {
  value: string;
  via: StaticStringVia;
  /**
   * Settings keys the string is rooted at, as written after the settings object.
   * The caller decides what a key means; here it is only recorded.
   */
  envRefs: string[];
  /** Whether a branch nobody settled was taken to arrive at the value. */
  guessed?: boolean;
}

/**
 * A settings key found behind a hole, and whatever literal text came with it.
 *
 * A helper that assembles an address answers with both: the settings it is
 * rooted at, and the part of the path it has already written.
 */
export interface SettingBehind {
  key: string;
  /** Literal text between the settings and whatever follows the hole. */
  prefix?: string;
  /** Whether a branch nobody settled was taken to arrive at that text. */
  guessed?: boolean;
}

export interface StaticStringOptions {
  /** Packages shared between repositories, so a constant read from one is known. */
  sharedPackages?: readonly string[];
  /** Identifiers that stand for a settings object, e.g. the one a build swaps out. */
  envRoots?: readonly string[];
  /**
   * What every hole becomes when its value is only known at run time.
   *
   * Left unset, a hole is judged by where it sits: one that fills a segment
   * outright becomes `:param`, and one that could run over a separator becomes
   * `UNREAD_SPAN`, which nothing matches. Set it only where the caller knows the
   * string is not an address and the distinction does not apply.
   */
  placeholder?: string;
  /**
   * Follows the opening hole back to a settings key when it is not one outright.
   *
   * A settings value is usually kept in a property before it is used, and the
   * property is not the setting. Supplied by a caller that knows how far it is
   * willing to follow.
   */
  settingBehind?: (node: TsNode) => SettingBehind | string | null;
  /**
   * Reads a hole the evaluator cannot, when a caller knows how.
   *
   * Tried only after the ordinary evaluation fails, so it can add answers and
   * never change one.
   */
  resolveSpan?: (node: TsNode) => string | null;
}

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
 * The settings key an expression reads, when it reads one.
 *
 * `environment.api.baseUrl` answers `api.baseUrl`: the whole path after the
 * root, because that is how the key is written in the configuration too.
 */
export const settingKeyIn = (expr: TsNode, roots: readonly string[]): string | null => {
  if (roots.length === 0 || !Node.isPropertyAccessExpression(expr)) return null;
  const parts: string[] = [];
  let current: TsNode = expr;
  while (Node.isPropertyAccessExpression(current)) {
    parts.unshift(current.getName());
    current = current.getExpression();
  }
  if (!Node.isIdentifier(current) || !roots.includes(current.getText())) return null;
  return parts.length === 0 ? null : parts.join('.');
};

const fromTemplate = (
  template: TemplateExpression,
  options: StaticStringOptions,
): StaticString => {
  const roots = options.envRoots ?? [];

  let value = template.getHead().getLiteralText();
  const envRefs: string[] = [];
  let guessed = false;

  const spans = template.getTemplateSpans();
  for (const [index, span] of spans.entries()) {
    const tail = span.getLiteral().getLiteralText();
    // Only a hole the string starts with can be its root. Dropping one from the
    // middle would leave a path that reads as complete and is not.
    const opening = value === '' && envRefs.length === 0;
    const direct = opening ? settingKeyIn(span.getExpression(), roots) : null;
    const behind =
      opening && direct === null ? options.settingBehind?.(span.getExpression()) : null;
    const found = behind === null || behind === undefined ? null : behind;
    const key = direct ?? (typeof found === 'string' ? found : (found?.key ?? null));
    if (key !== null) {
      const root = typeof found === 'object' && found !== null ? found : undefined;
      envRefs.push(key);
      // The half behind the hole may have been arrived at through a branch
      // nobody settled, and the text this returns says nothing about how it was
      // read. Carrying it is what lets the edge downstream say `heuristic`.
      if (root?.guessed === true) guessed = true;
      value = (root?.prefix ?? '') + tail;
      continue;
    }
    const evaluated = evaluateExpression(span.getExpression());
    const read =
      evaluated.resolved && typeof evaluated.value === 'string'
        ? evaluated.value
        : options.resolveSpan?.(span.getExpression());
    const hole =
      options.placeholder ??
      (choosesASegment(span.getExpression())
        ? UNREAD_SPAN
        : holeIn(value, tail, index === spans.length - 1));
    value += (read ?? hole) + tail;
  }

  return { value, via: 'template', envRefs, ...(guessed ? { guessed: true } : {}) };
};

/**
 * Reads a string out of the source without running it.
 *
 * The one place that follows a name to the text behind it: a literal, a template
 * whose holes can be filled or named, a constant, an enum member, or the same
 * read through a package the services share. Returns null when the string is
 * only known at run time, which is a fact worth recording rather than guessing
 * around: a route path or a channel name invented here becomes a confident edge
 * that is simply wrong.
 */
export const resolveStaticString = (
  expr: TsNode,
  options: StaticStringOptions = {},
): StaticString | null => {
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
    return { value: expr.getLiteralValue(), via: 'literal', envRefs: [] };
  }

  if (Node.isTemplateExpression(expr)) return fromTemplate(expr, options);

  const evaluated = evaluateExpression(expr);
  if (!evaluated.resolved || typeof evaluated.value !== 'string') return null;

  const declaration = declarationOf(expr);
  const shared = sharedPackageOf(declaration, options.sharedPackages ?? []);
  const via: StaticStringVia =
    shared !== undefined
      ? 'shared-package'
      : declaration !== undefined && Node.isEnumMember(declaration)
        ? 'enum'
        : 'const';
  return { value: evaluated.value, via, envRefs: [] };
};

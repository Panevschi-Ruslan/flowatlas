import { Node, SyntaxKind, type Node as TsNode } from 'ts-morph';
import type { DefinitionPosition as Position } from './adapters/deployment.js';
import { lineAndColumnAt } from './line-numbers.js';
import type { PathStep, PositionedDocument } from './positioned-document.js';
import { declarationOf, evaluateExpression } from './static-value.js';

/**
 * A value written in TypeScript as a literal, read as a positioned document
 * (P57).
 *
 * A deployment is sometimes described by a module whose export is one object
 * literal - the same document another tool would write in YAML - built with
 * constants, imports, spreads and templates. Read as a positioned document, it
 * is one more spelling of that document, so whatever reads the YAML reads this
 * unchanged: values to walk, and a line beside each member.
 *
 * Only what is written is read. A member that is anything else - a call, a
 * parameter, a value computed at run time - is an {@link UnreadMember} saying
 * what it is, in its place, so one unread member does not cost its siblings.
 */

/** A member of a document whose value is not written out, kept in its place. */
export class UnreadMember {
  constructor(
    /** The member as written, shortened. */
    readonly text: string,
    readonly reason: string,
  ) {}
}

const MAX_DEPTH = 16;

const keyOf = (path: readonly PathStep[]): string => JSON.stringify(path);

const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
};

const unwrap = (node: TsNode): TsNode => {
  let current = node;
  while (
    Node.isParenthesizedExpression(current) ||
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
};

/** The name a property is written under, when it is written out. */
const propertyName = (name: TsNode): string | undefined => {
  if (Node.isIdentifier(name) || Node.isPrivateIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name) || Node.isNumericLiteral(name)) {
    return String(name.getLiteralValue());
  }
  if (Node.isComputedPropertyName(name)) {
    const value = evaluateExpression(name.getExpression());
    return value.resolved && (typeof value.value === 'string' || typeof value.value === 'number') ? String(value.value) : undefined;
  }
  return undefined;
};

class Reading {
  readonly positions = new Map<string, Position>();

  constructor(readonly file: string) {}

  /** Where a node is written, when it is written in the document's own file. */
  #record(path: readonly PathStep[], node: TsNode): void {
    const source = node.getSourceFile();
    if (source.getFilePath() !== this.file) return;
    this.positions.set(keyOf(path), lineAndColumnAt(source, node.getStart()));
  }

  /** What a name stands for, when it is a constant this can follow to its initializer. */
  #initializerOf(node: TsNode): TsNode | undefined {
    const declaration = declarationOf(node);
    if (declaration === undefined) return undefined;
    if (Node.isVariableDeclaration(declaration)) {
      const statement = declaration.getVariableStatement();
      if (statement !== undefined && statement.getDeclarationKind() !== 'const') return undefined;
      return declaration.getInitializer();
    }
    if (Node.isPropertyAssignment(declaration)) return declaration.getInitializer();
    if (Node.isExportAssignment(declaration)) return declaration.getExpression();
    return undefined;
  }

  read(node: TsNode, path: PathStep[], depth: number): unknown {
    if (depth > MAX_DEPTH) return new UnreadMember(shorten(node.getText()), 'nesting-too-deep');
    const expr = unwrap(node);
    if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue();
    if (Node.isNumericLiteral(expr)) return expr.getLiteralValue();
    if (Node.isTrueLiteral(expr)) return true;
    if (Node.isFalseLiteral(expr)) return false;
    if (expr.getKind() === SyntaxKind.NullKeyword) return null;
    if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.MinusToken) {
      const inner = this.read(expr.getOperand(), path, depth + 1);
      return typeof inner === 'number' ? -inner : new UnreadMember(shorten(expr.getText()), 'not-a-literal');
    }
    if (Node.isObjectLiteralExpression(expr)) return this.#object(expr, path, depth);
    if (Node.isArrayLiteralExpression(expr)) return this.#array(expr, path, depth);
    if (Node.isTemplateExpression(expr) || Node.isBinaryExpression(expr)) {
      const value = evaluateExpression(expr);
      return value.resolved ? value.value : new UnreadMember(shorten(expr.getText()), value.reason);
    }
    if (Node.isIdentifier(expr) || Node.isPropertyAccessExpression(expr) || Node.isElementAccessExpression(expr)) {
      const initializer = this.#initializerOf(expr);
      if (initializer !== undefined) return this.read(initializer, path, depth + 1);
      // A member of a constant object written elsewhere, or a literal type.
      const value = evaluateExpression(expr);
      if (value.resolved) return value.value;
      if (Node.isPropertyAccessExpression(expr)) {
        const owner = this.read(expr.getExpression(), path, depth + 1);
        if (owner !== null && typeof owner === 'object' && !Array.isArray(owner) && !(owner instanceof UnreadMember)) {
          const member = (owner as Record<string, unknown>)[expr.getName()];
          if (member !== undefined) return member;
        }
      }
      return new UnreadMember(shorten(expr.getText()), value.reason);
    }
    return new UnreadMember(shorten(expr.getText()), 'not-a-literal');
  }

  #object(expr: TsNode & { getProperties(): TsNode[] }, path: PathStep[], depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const property of expr.getProperties()) {
      if (Node.isPropertyAssignment(property)) {
        const name = propertyName(property.getNameNode());
        const initializer = property.getInitializer();
        if (name === undefined || initializer === undefined) continue;
        const inner = [...path, name];
        this.#record(inner, property);
        out[name] = this.read(initializer, inner, depth + 1);
      } else if (Node.isShorthandPropertyAssignment(property)) {
        const name = property.getName();
        const inner = [...path, name];
        this.#record(inner, property);
        // The name is the property's own symbol; the value it stands for is the
        // variable of that name, imported or not.
        const symbol = property.getValueSymbol();
        const declaration = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
        const initializer = declaration !== undefined && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
        out[name] = initializer === undefined ? this.read(property.getNameNode(), inner, depth + 1) : this.read(initializer, inner, depth + 1);
      } else if (Node.isSpreadAssignment(property)) {
        const spread = this.read(property.getExpression(), path, depth + 1);
        if (spread !== null && typeof spread === 'object' && !Array.isArray(spread) && !(spread instanceof UnreadMember)) {
          for (const [name, value] of Object.entries(spread as Record<string, unknown>)) {
            const inner = [...path, name];
            if (!this.positions.has(keyOf(inner))) this.#record(inner, property);
            out[name] = value;
          }
        }
      } else if (Node.isMethodDeclaration(property)) {
        const name = propertyName(property.getNameNode());
        if (name !== undefined) out[name] = new UnreadMember(shorten(property.getText()), 'method');
      }
    }
    return out;
  }

  #array(expr: TsNode & { getElements(): TsNode[] }, path: PathStep[], depth: number): unknown[] {
    const out: unknown[] = [];
    for (const element of expr.getElements()) {
      if (Node.isSpreadElement(element)) {
        const spread = this.read(element.getExpression(), path, depth + 1);
        if (Array.isArray(spread)) {
          for (const item of spread) {
            this.#record([...path, out.length], element);
            out.push(item);
          }
        } else {
          this.#record([...path, out.length], element);
          out.push(spread instanceof UnreadMember ? spread : new UnreadMember(shorten(element.getText()), 'not-a-list'));
        }
        continue;
      }
      const inner = [...path, out.length];
      this.#record(inner, element);
      out.push(this.read(element, inner, depth + 1));
    }
    return out;
  }
}

/**
 * An expression read as a document, with a position for every member written
 * in the expression's own file. A member read from a constant in another file
 * has the position of where it is brought in: a spread, a name.
 */
export const readExpressionDocument = (node: TsNode): PositionedDocument => {
  const reading = new Reading(node.getSourceFile().getFilePath());
  const value = reading.read(node, [], 0);
  reading.positions.set(keyOf([]), lineAndColumnAt(node.getSourceFile(), node.getStart()));
  return { value, at: (path) => reading.positions.get(keyOf(path)) };
};

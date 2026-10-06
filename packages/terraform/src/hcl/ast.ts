/**
 * The tree HCL native syntax is parsed into.
 *
 * Every block and every attribute keeps the file and the line it was written
 * on, because every node and edge this reading produces carries both: a route
 * whose Terraform cannot be pointed at is a route nobody can go and check. That
 * is the reason this is a parser of the tool's own rather than a dependency
 * that hands back JSON (see the ticket that introduced it, P21).
 *
 * Expressions keep their own position too, so an evaluation that gives up can
 * say where.
 */

export interface Position {
  /** Repo-relative POSIX path, or whatever name the caller gave the text. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

/** One step of a traversal after its root: `.name` or `[key]`. */
export type Step =
  | { readonly kind: 'attr'; readonly name: string }
  | { readonly kind: 'index'; readonly key: Expression };

/** A piece of a template: text, an interpolation, or a directive. */
export type TemplatePart =
  | { readonly kind: 'text'; text: string }
  | {
      readonly kind: 'interpolation';
      readonly expression: Expression;
      readonly stripBefore: boolean;
      readonly stripAfter: boolean;
    }
  | {
      readonly kind: 'if';
      readonly condition: Expression;
      readonly then: TemplatePart[];
      readonly otherwise: TemplatePart[];
    }
  | {
      readonly kind: 'for';
      readonly keyName?: string;
      readonly valueName: string;
      readonly collection: Expression;
      readonly body: TemplatePart[];
    };

/** An item of an object constructor. A bare identifier key is a literal string. */
export interface ObjectItem {
  readonly key: Expression;
  readonly value: Expression;
}

export type BinaryOperator =
  | '||'
  | '&&'
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%';

export type Expression =
  | { readonly type: 'literal'; readonly value: string | number | boolean | null; readonly pos: Position }
  | {
      readonly type: 'template';
      readonly parts: TemplatePart[];
      readonly pos: Position;
      /** Written as a heredoc, so its text starts on the line after `pos`. */
      readonly heredoc?: true;
    }
  | { readonly type: 'tuple'; readonly items: Expression[]; readonly pos: Position }
  | { readonly type: 'object'; readonly items: ObjectItem[]; readonly pos: Position }
  | { readonly type: 'variable'; readonly name: string; readonly pos: Position }
  | {
      readonly type: 'traversal';
      readonly source: Expression;
      readonly steps: Step[];
      readonly pos: Position;
    }
  | {
      /** `a[*].b` and `a.*.b`: every element of `a`, each followed by the steps. */
      readonly type: 'splat';
      readonly source: Expression;
      readonly steps: Step[];
      readonly pos: Position;
    }
  | {
      readonly type: 'call';
      /** `provider::aws::arn_parse` keeps its namespace in the name. */
      readonly name: string;
      readonly args: Expression[];
      /** The last argument was written `list...`. */
      readonly expandFinal: boolean;
      readonly pos: Position;
    }
  | {
      readonly type: 'conditional';
      readonly condition: Expression;
      readonly then: Expression;
      readonly otherwise: Expression;
      readonly pos: Position;
    }
  | {
      readonly type: 'binary';
      readonly operator: BinaryOperator;
      readonly left: Expression;
      readonly right: Expression;
      readonly pos: Position;
    }
  | { readonly type: 'unary'; readonly operator: '!' | '-'; readonly operand: Expression; readonly pos: Position }
  | {
      readonly type: 'for';
      /** `[for …]` builds a list, `{for …}` builds an object. */
      readonly result: 'tuple' | 'object';
      readonly keyName?: string;
      readonly valueName: string;
      readonly collection: Expression;
      /** The key expression of an object `for`; absent for a tuple one. */
      readonly key?: Expression;
      readonly value: Expression;
      readonly condition?: Expression;
      /** `k => v...`: values sharing a key are grouped into a list. */
      readonly group: boolean;
      readonly pos: Position;
    }
  | { readonly type: 'parens'; readonly inner: Expression; readonly pos: Position };

export interface Attribute {
  readonly name: string;
  readonly expression: Expression;
  /** The expression as written, for messages that quote it. */
  readonly source: string;
  readonly pos: Position;
}

export interface Block {
  readonly type: string;
  readonly labels: readonly string[];
  readonly body: Body;
  readonly pos: Position;
}

export interface Body {
  readonly attributes: readonly Attribute[];
  readonly blocks: readonly Block[];
}

/** A whole file. */
export interface HclFile {
  readonly file: string;
  readonly body: Body;
}

/** The first attribute of a body with this name, if there is one. */
export const attributeOf = (body: Body, name: string): Attribute | undefined =>
  body.attributes.find((attribute) => attribute.name === name);

/** Every nested block of a body with this type, in the order written. */
export const blocksOf = (body: Body, type: string): Block[] =>
  body.blocks.filter((block) => block.type === type);

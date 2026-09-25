import { makeLeafId, siteOf } from '@flowatlas/core';
import type { JsxAttribute, Node as TsNode } from 'ts-morph';
import { Node } from 'ts-morph';
import type { ReactExtractContext } from '../context.js';
import type { IndexedFunction } from '../index-functions.js';
import { definePass } from './types.js';

/** The convention the framework enforces: a handler prop is called `onSomething`. */
const HANDLER_PROP = /^on[A-Z]/;

/**
 * Attributes that read as handlers and are not what this is after.
 *
 * `onChange` on a form field fires on every keystroke and reaches nothing
 * across a boundary; listing it would put a node on every input in the
 * repository. What is wanted is the click that starts a flow.
 */
const IGNORED = new Set(['onChange', 'onInput', 'onBlur', 'onFocus', 'onKeyDown', 'onKeyUp', 'onMouseEnter', 'onMouseLeave', 'onScroll']);

/** The function of this repository a handler expression names, when it names one. */
const namedHandler = (
  ctx: ReactExtractContext,
  expression: TsNode,
): IndexedFunction | undefined => {
  const named = Node.isPropertyAccessExpression(expression) ? expression.getNameNode() : expression;
  if (!Node.isIdentifier(named)) return undefined;
  const symbol = named.getSymbol();
  if (symbol === undefined) return undefined;
  for (const declaration of (symbol.getAliasedSymbol() ?? symbol).getDeclarations()) {
    const indexed = ctx.functions.get(declaration as never);
    if (indexed !== undefined) return indexed;
  }
  return undefined;
};

/**
 * The clicks a screen offers.
 *
 * The same conclusion the other front end's template reader comes to, from a
 * different source: there the markup is a separate file in a language of its
 * own, here it is an expression in the middle of the function. What comes out
 * is identical — a `ui_action` node at the place the handler is written, and an
 * edge to the code it runs — because what the graph says about a click does not
 * depend on how the click was spelled.
 *
 * Where a handler is written in place, or names something declared inside the
 * component, the edge points at the component itself. That is not a
 * simplification: the code really is written there, and the walk onward from
 * the component is the same walk it would have been.
 */
export const actionsPass = definePass('actions', (ctx: ReactExtractContext) => {
  const record = (indexed: IndexedFunction, attribute: JsxAttribute): void => {
    const name = attribute.getNameNode().getText();
    if (!HANDLER_PROP.test(name) || IGNORED.has(name)) return;
    const initializer = attribute.getInitializer();
    if (initializer === undefined || !Node.isJsxExpression(initializer)) return;
    const expression = initializer.getExpression();
    if (expression === undefined) return;

    const at = siteOf(attribute);
    const id = makeLeafId('ui_action', ctx.repo, indexed.file, at.line, at.column);
    const source = expression.getText().replaceAll(/\s+/g, ' ').slice(0, 80);
    const handler = namedHandler(ctx, expression);
    const target = handler ?? indexed;

    ctx.builder.addNode({
      id,
      type: 'ui_action',
      label: `${name}={${source}}`,
      repo: ctx.repo,
      file: indexed.file,
      line: at.line,
      kind: 'event',
      meta: {
        event: name,
        handler: source,
        component: indexed.id,
        // Said plainly, because a walk from this click is only as narrow as the
        // answer to "which code does the handler run".
        handlerVia: handler === undefined ? 'enclosing' : 'named',
      },
    });

    ctx.ensureFunctionNode(indexed.fn);
    ctx.ensureFunctionNode(target.fn);
    ctx.builder.addEdge({
      from: id,
      to: target.id,
      type: 'handles',
      confidence: 'static',
      file: indexed.file,
      line: at.line,
    });
  };

  for (const indexed of ctx.functions.all()) {
    if (indexed.role !== 'component') continue;
    indexed.fn.body.forEachDescendant((node) => {
      if (Node.isJsxAttribute(node)) record(indexed, node);
    });
  }
});

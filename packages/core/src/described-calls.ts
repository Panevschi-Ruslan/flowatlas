import { Node, type CallExpression } from 'ts-morph';
import type { GraphBuilder } from './builder.js';

/**
 * Calls a description matched, as the calls reader names one whose receiver
 * it could not follow (R173, P121).
 *
 * A call whose receiver has no type is a place static reading cannot see,
 * until a description says what it is: then it is read - as a publish, a
 * start, a request, a table access - and the row saying it could not be goes.
 * Every reader that reads a description keeps the calls it matched here and
 * withdraws the rows once, so a place a pattern now covers is counted as
 * fixed in the next build's Can't follow totals.
 */

/** What a call calls, spelled the way the calls reader spells it: `receiver.method`. */
const calleeOf = (call: CallExpression): string => {
  const callee = call.getExpression();
  return Node.isPropertyAccessExpression(callee) ? `${callee.getExpression().getText()}.${callee.getName()}` : callee.getText();
};

/** The key a call is remembered by: its file, its line and what it calls. */
export const describedCallKey = (file: string, line: number, call: CallExpression): string => `${file}\0${line}\0${calleeOf(call)}`;

/** Withdraws every `call-dynamic-receiver` row at a call a description matched. */
export const withdrawDescribedCalls = (builder: GraphBuilder, described: ReadonlySet<string>): void => {
  if (described.size === 0) return;
  builder.withdrawUnresolved(
    (row) =>
      row.reason === 'call-dynamic-receiver' &&
      row.symbol !== undefined &&
      described.has(`${row.file}\0${row.line}\0${row.symbol.slice(row.symbol.indexOf(' -> ') + ' -> '.length)}`),
  );
};

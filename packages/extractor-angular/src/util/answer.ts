import { resolve, sep } from 'node:path';
import {
  ANSWER_READ_META,
  ANSWER_UNREAD_META,
  answerFieldsRead,
  type AnswerMemberUse,
  type AnswerStart,
  type FunctionLike,
} from '@flowatlas/core';
import { Node, type CallExpression, type ClassDeclaration, type Node as TsNode } from 'ts-morph';
import type { AngularExtractContext } from '../context.js';
import { componentDecorator } from '../index-classes.js';
import { templateOf } from '../passes/templates.js';
import { readTemplateMembers, type TemplateMemberRows } from '../template-members.js';
import { metadataOf, stringProperty } from './metadata.js';

/**
 * The fields of its answer the code that makes a request reads, for this
 * reader (P391): the core follows the answer, and this hands it what only an
 * Angular reader knows - what a component's template does with a member, and
 * which component an element of a template is.
 */
export interface AnswerReader {
  /** The meta a request's node carries: `answerRead`, and `answerUnread` where a use was not followed. */
  metaOf(start: AnswerStart, rootId: string): Record<string, unknown>;
}

/** Whether a member of a component is a signal input, `order = input<Order>()`, read by calling it. */
const holdsOf = (owner: ClassDeclaration, member: string): 'value' | 'signal' => {
  const property = owner.getProperty(member);
  const initializer = property?.getInitializer();
  if (initializer === undefined || !Node.isCallExpression(initializer)) return 'value';
  const callee = initializer.getExpression().getText();
  return /^(?:input|input\.required|model|model\.required)$/.test(callee) ? 'signal' : 'value';
};

export const answerReader = (ctx: AngularExtractContext): AnswerReader => {
  const root = resolve(ctx.repoDir);
  const isOwn = (declaration: TsNode): boolean => {
    const file = declaration.getSourceFile();
    const path = file.getFilePath();
    return !file.isDeclarationFile() && !path.includes(`${sep}node_modules${sep}`) && !path.includes('/node_modules/') && resolve(path).startsWith(root);
  };
  const idOf = (fn: FunctionLike): string | undefined => (Node.isMethodDeclaration(fn) ? ctx.methodIdOf(fn) : undefined);

  /** The component an element of a template is, by the tag its selector names. */
  let byTag: Map<string, ClassDeclaration> | undefined;
  const componentAt = (tag: string): ClassDeclaration | undefined => {
    if (byTag === undefined) {
      byTag = new Map();
      for (const indexed of ctx.classes.all()) {
        if (indexed.role !== 'component') continue;
        const selector = stringProperty(metadataOf(componentDecorator(indexed.declaration)), 'selector');
        for (const each of selector?.split(',') ?? []) {
          const name = each.trim();
          if (/^[a-z][\w-]*$/i.test(name) && !byTag.has(name)) byTag.set(name, indexed.declaration);
        }
      }
    }
    return byTag.get(tag);
  };

  const rowsByClass = new Map<ClassDeclaration, { rows: TemplateMemberRows; file: string; id: string } | null>();
  const templateRows = (owner: ClassDeclaration): { rows: TemplateMemberRows; file: string; id: string } | null => {
    const known = rowsByClass.get(owner);
    if (known !== undefined) return known;
    const indexed = ctx.classes.get(owner);
    const template = indexed === undefined || indexed.role !== 'component' ? null : templateOf(ctx, indexed);
    let found: { rows: TemplateMemberRows; file: string; id: string } | null = null;
    if (indexed !== undefined && template !== null && 'source' in template) {
      try {
        found = { rows: readTemplateMembers(template.source, template.file, template.startLine), file: template.file, id: indexed.id };
        ctx.ensureClassNode(owner);
      } catch {
        found = null;
      }
    }
    rowsByClass.set(owner, found);
    return found;
  };

  const memberUse = (owner: ClassDeclaration, member: string): AnswerMemberUse | undefined => {
    const template = templateRows(owner);
    if (template === null) return undefined;
    const { rows, file, id } = template;
    const unread: Array<{ line: number; file: string; why: string }> = rows.unread.filter((row) => row.member === member).map((row) => ({ line: row.line, file, why: row.why }));
    const bound: Array<AnswerMemberUse['bound'][number]> = [];
    for (const row of rows.bound) {
      if (row.member !== member) continue;
      if (row.element === null) {
        bound.push({ owner, member: row.property, holds: holdsOf(owner, row.property), path: row.path });
        continue;
      }
      const child = componentAt(row.element);
      if (child !== undefined) {
        bound.push({ owner: child, member: row.property, holds: holdsOf(child, row.property), path: row.path });
      } else if (row.path.length === 0 && row.element.includes('-')) {
        unread.push({ line: row.line, file, why: `bound to [${row.property}] of <${row.element}>, a component not read` });
      }
    }
    return {
      in: id,
      reads: rows.reads.filter((row) => row.member === member).map((row) => ({ path: row.path, line: row.line, file })),
      handed: rows.handed.filter((row) => row.member === member).map((row) => ({ method: row.method, index: row.index, path: row.path })),
      bound,
      unread,
    };
  };

  return {
    metaOf: (start, rootId) => {
      const found = answerFieldsRead(start, { idOf, isOwn, rootId, memberUse });
      const unread = [...found.unread, ...(found.cut === undefined ? [] : [{ line: start.call.getStartLineNumber(), why: `cut: ${found.cut}` }])];
      return { [ANSWER_READ_META]: found.reads, ...(unread.length === 0 ? {} : { [ANSWER_UNREAD_META]: unread }) };
    },
  };
};

/** The calls a request was followed out through, innermost first, or the caller it is written for. */
export const throughOf = (network: CallExpression, site: TsNode, frames: readonly { call: CallExpression }[]): CallExpression[] =>
  frames.length > 0 ? frames.map((frame) => frame.call) : site !== network && Node.isCallExpression(site) ? [site] : [];

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  findMethod,
  methodNamedOn,
  lineOf,
  makeLeafId,
  normalizeFilePath,
  normalizePath,
  siteOf,
  type ClassMethod,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from '../context.js';
import { componentDecorator, type IndexedClass } from '../index-classes.js';
import { parseAngularTemplate, type TemplateEvent, type TemplateHandler } from '../template.js';
import { metadataOf, propertyOf, stringProperty } from '../util/metadata.js';
import { definePass } from './types.js';

/** Framework callbacks that run a component's own code without anyone asking. */
const LIFECYCLE = ['ngOnInit', 'ngAfterViewInit', 'ngOnDestroy'] as const;

interface TemplateText {
  source: string;
  /** Repo-relative POSIX path the trigger ids are built from. */
  file: string;
  startLine: number;
  startColumn: number;
}

/**
 * Where a component's template is and what it says.
 *
 * A template in a file of its own is read from disk, since the compiler never
 * sees it from here; one written inline is read where it stands, and its
 * position is carried along so a trigger's id points at the line a reader will
 * actually find it on.
 */
const templateOf = (
  ctx: AngularExtractContext,
  indexed: IndexedClass,
): TemplateText | { missing: string; line: number } | null => {
  const metadata = metadataOf(componentDecorator(indexed.declaration));
  const templateUrl = propertyOf(metadata, 'templateUrl');
  if (templateUrl !== undefined) {
    const relative = stringProperty(metadata, 'templateUrl');
    if (relative === undefined) {
      return { missing: templateUrl.getText(), line: lineOf(templateUrl) };
    }
    const path = resolve(dirname(indexed.declaration.getSourceFile().getFilePath()), relative);
    try {
      return {
        source: readFileSync(path, 'utf8'),
        file: normalizeFilePath(path, ctx.repoDir),
        startLine: 1,
        startColumn: 1,
      };
    } catch {
      return { missing: relative, line: lineOf(templateUrl) };
    }
  }

  const inline = propertyOf(metadata, 'template');
  if (inline === undefined) return null;
  const source = stringProperty(metadata, 'template');
  if (source === undefined) return { missing: inline.getText(), line: lineOf(inline) };
  const at = siteOf(inline);
  // The text starts one character past the quote that opens it.
  return { source, file: indexed.file, startLine: at.line, startColumn: at.column + 1 };
};

/**
 * Every route configured to answer a link, screen or no screen.
 *
 * A route whose screen could not be read still answers the link, and saying so
 * is the difference between "nothing serves this path" and "something does, and
 * I could not read what it shows".
 */
const routesFor = (routes: readonly RouteEntry[], link: string): RouteEntry[] => {
  const wanted = normalizePath(link);
  return routes.filter((route) => route.path === wanted);
};

export const templatesPass = definePass('templates', (ctx) => {
  /** The method a name reaches on a class or anything it extends. */
  const inheritedMethod = (owner: ClassDeclaration, name: string): ClassMethod | undefined =>
    findMethod(owner, name).method;

  /**
   * The class whose method a handler is naming.
   *
   * The component itself for a bare call, and whatever it injects for a call
   * through a property. Undefined covers everything that never named a method of
   * a class this repository declares: an assignment, a signal, an emitter, a
   * form, the event object, a template reference, a class from a package.
   */
  const handlerOwner = (
    owner: ClassDeclaration,
    handler: TemplateHandler,
  ): ClassDeclaration | undefined => {
    if (handler.kind === 'method') return owner;
    if (handler.kind === 'other') return undefined;
    const entry = ctx.di.lookup(owner, handler.property);
    return entry?.resolution.kind === 'class' ? entry.resolution.declaration : undefined;
  };

  /** The method a handler names, on the component or on something it injects. */
  const handlerMethod = (
    owner: ClassDeclaration,
    handler: TemplateHandler,
  ): ClassMethod | undefined => {
    if (handler.kind === 'other') return undefined;
    const target = handlerOwner(owner, handler);
    return target === undefined ? undefined : inheritedMethod(target, handler.method);
  };

  const action = (
    indexed: IndexedClass,
    event: TemplateEvent,
    template: TemplateText,
  ): void => {
    const id = makeLeafId('ui_action', ctx.repo, template.file, event.line, event.column);
    const [first] = event.handlers;
    const args = first !== undefined && first.kind !== 'other' ? first.args : [];

    ctx.builder.addNode({
      id,
      type: 'ui_action',
      label: `${event.name}="${event.source}"`,
      repo: ctx.repo,
      file: template.file,
      line: event.line,
      kind: event.kind,
      meta: {
        event: event.name,
        handler: event.source,
        component: indexed.id,
        template: template.file,
        ...(event.route === undefined ? {} : { route: event.route }),
        ...(args.length === 0 ? {} : { args }),
      },
    });

    if (event.kind === 'route') {
      const answering =
        event.route === null || event.route === undefined ? [] : routesFor(ctx.routes, event.route);
      const route = answering.find((candidate) => candidate.component !== undefined);
      const target = route?.component === undefined ? undefined : ctx.classes.get(route.component);
      if (target !== undefined) {
        ctx.ensureClassNode(target.declaration);
        ctx.builder.addEdge({
          from: id,
          to: target.id,
          type: 'triggers',
          confidence: 'static',
          file: template.file,
          line: event.line,
        });
        return;
      }
      // Without a routed screen to point at there is nothing to say: a link is
      // only unresolved against a configuration that exists.
      if (ctx.routes.length === 0) return;
      if (event.route === null || event.route === undefined) {
        // A link assembled from data names no path, so there is no route to
        // look for. Nothing a reader can do about it, and one line saying so is
        // as much as a list of them would say.
        ctx.report({
          file: template.file,
          line: event.line,
          reason: 'route-link-dynamic',
          level: 'info',
          hint: 'The path is built at run time, so no configured route can be matched against it.',
          symbol: `${indexed.name} ${event.source}`,
        });
        return;
      }
      if (answering.length > 0) {
        // The path is configured; what it shows is what could not be read. The
        // route itself already carries a row naming the loader, so a second one
        // per link would repeat it without adding a place to look.
        ctx.report({
          file: template.file,
          line: event.line,
          reason: 'route-screen-unread',
          level: 'info',
          hint: 'A route answers this link, but nothing in the configuration said which component it shows — a redirect, or a loader that was not read.',
          symbol: `${indexed.name} ${event.source}`,
        });
        return;
      }
      ctx.report({
        file: template.file,
        line: event.line,
        reason: 'route-target-unresolved',
        hint: `No configured route answers ${event.route}.`,
        symbol: `${indexed.name} ${event.source}`,
      });
      return;
    }

    let handled = false;
    for (const handler of event.handlers) {
      const method = handlerMethod(indexed.declaration, handler);
      if (method === undefined) continue;
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      ctx.ensureMethodNode(method);
      ctx.builder.addEdge({
        from: id,
        to: methodId,
        type: 'handles',
        confidence: 'static',
        file: template.file,
        line: event.line,
      });
      handled = true;
    }

    if (handled) return;
    const only = event.handlers[0];
    const symbol = `${indexed.name} (${event.name})="${event.source}"`;

    // A binding that names a method of a class the extractor can see, and does
    // not find one, is a template calling something that is gone. That is worth
    // a line of its own.
    const named = only === undefined || only.kind === 'other' ? undefined : only;
    const declaring = named === undefined ? undefined : handlerOwner(indexed.declaration, named);
    if (named !== undefined && declaring !== undefined) {
      ctx.report({
        file: template.file,
        line: event.line,
        reason: 'handler-not-found',
        hint: `No method named ${named.method} is declared on ${declaring.getName() ?? indexed.name}.`,
        symbol,
      });
      return;
    }

    // Everything else never named a method to begin with. An assignment has no
    // method behind it, and a call on a signal, an emitter, a form, the event
    // object or a template reference reaches something the graph has no node
    // for. The templates are right; there is simply nothing to point at.
    ctx.report({
      file: template.file,
      line: event.line,
      reason: 'handler-not-a-method',
      // Not a limit of static reading: there is no method, in any repository,
      // that this binding could be joined to. The place is recorded and counted
      // apart from what was missed.
      level: 'nothing',
      hint: 'The binding is an assignment, or a call on something that is not an injected class, so no method node answers it.',
      symbol,
    });
  };

  const lifecycle = (indexed: IndexedClass): void => {
    for (const name of LIFECYCLE) {
      // `ngOnInit = () => {}` is a lifecycle hook like any other: the framework
      // calls whatever the property holds, and asking only for a declared
      // method left the screen with no way in (R29).
      const method = methodNamedOn(indexed.declaration, name);
      if (method === undefined) continue;
      const methodId = ctx.methodIdOf(method);
      if (methodId === undefined) continue;
      const at = siteOf(method);
      const id = makeLeafId('ui_action', ctx.repo, indexed.file, at.line, at.column);
      ctx.builder.addNode({
        id,
        type: 'ui_action',
        label: name,
        repo: ctx.repo,
        file: indexed.file,
        line: at.line,
        kind: 'lifecycle',
        meta: {
          event: name,
          handler: name,
          component: indexed.id,
          template: indexed.file,
        },
      });
      ctx.ensureMethodNode(method);
      ctx.builder.addEdge({
        from: id,
        to: methodId,
        type: 'handles',
        confidence: 'static',
        file: indexed.file,
        line: at.line,
      });
    }
  };

  for (const indexed of ctx.classes.withRole('component')) {
    lifecycle(indexed);

    const template = templateOf(ctx, indexed);
    if (template === null) continue;
    if ('missing' in template) {
      ctx.report({
        file: indexed.file,
        line: template.line,
        reason: 'template-not-found',
        hint: `Could not read ${template.missing}. Check templateUrl relative to the component file.`,
        symbol: indexed.name,
      });
      continue;
    }

    ctx.stats.templates += 1;
    const events = parseAngularTemplate(template.source, template.file, {
      startLine: template.startLine,
      startColumn: template.startColumn,
      onError: (message, line) => {
        ctx.report({
          file: template.file,
          line,
          reason: 'template-not-parsed',
          hint: `${message} Every trigger in this template is missing from the graph until it is fixed.`,
          symbol: indexed.name,
        });
      },
    });
    for (const event of events) action(indexed, event, template);
  }
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  findMethod,
  methodNamedOn,
  lineOf,
  makeLeafId,
  NAVIGATES_META,
  normalizeFilePath,
  normalizePath,
  siteOf,
  type ClassMethod,
} from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import type { AngularExtractContext, RouteEntry } from '../context.js';
import { componentDecorator, type IndexedClass } from '../index-classes.js';
import { readAddress, type ListedReading } from '../listed.js';
import { parseAngularTemplate, type TemplateEvent, type TemplateHandler } from '../template.js';
import { metadataOf, propertyOf, stringProperty } from '../util/metadata.js';
import { holdsRouterAs, landNavigation, writtenOfText } from './navigations.js';
import { definePass } from './types.js';

/** The router's methods a template's handler navigates with. */
const NAVIGATING: ReadonlySet<string> = new Set(['navigate', 'navigateByUrl']);

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

/** Whether an address is nothing but holes - `:param`, `/:param` - which names no route to look for (P363). */
const onlyHoles = (path: string): boolean => path.split('/').every((segment) => segment === '' || segment === ':param');

/**
 * The routes that answer an address read off a list's entry (P363): the one
 * spelled exactly, else those whose parameters take the entry's values -
 * an entry's `/orders/42` is the route `/orders/:id`.
 */
const routesMatching = (routes: readonly RouteEntry[], link: string): RouteEntry[] => {
  const exact = routesFor(routes, link.split(/[?#]/)[0] ?? link);
  if (exact.length > 0) return exact;
  const wanted = normalizePath(link.split(/[?#]/)[0] ?? link).split('/');
  return routes.filter((route) => {
    const segments = route.path.split('/');
    return segments.length === wanted.length && segments.every((segment, at) => segment === wanted[at] || segment.startsWith(':'));
  });
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
   * form, the event object, a name the template itself bound, a class from a
   * package.
   */
  const handlerOwner = (
    owner: ClassDeclaration,
    handler: TemplateHandler,
  ): ClassDeclaration | undefined => {
    if (handler.kind === 'method') return owner;
    if (handler.kind !== 'member') return undefined;
    const entry = ctx.di.lookup(owner, handler.property);
    return entry?.resolution.kind === 'class' ? entry.resolution.declaration : undefined;
  };

  /** The method a handler names, on the component or on something it injects. */
  const handlerMethod = (
    owner: ClassDeclaration,
    handler: TemplateHandler,
  ): ClassMethod | undefined => {
    if (handler.kind === 'other' || handler.kind === 'local') return undefined;
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
    // A link spelled from what the template reads, read over the list it walks (P363).
    const listed = event.kind === 'route' && event.address !== undefined ? readAddress(event.address, { loops: event.loops ?? new Map(), owner: indexed.declaration }) : undefined;

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
        ...(listed === undefined || listed.paths.length === 0 ? {} : { routes: listed.paths, ...(listed.lists.length === 0 ? {} : { listedFrom: listed.lists }) }),
        ...(args.length === 0 ? {} : { args }),
      },
    });

    if (event.kind === 'route' && listed !== undefined && listed.paths.length > 0) {
      landListed(indexed, event, template, id, listed);
      return;
    }

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
      if (event.route === null || event.route === undefined || (listed !== undefined && onlyHoles(event.route))) {
        // A link assembled from data names no path, so there is no route to
        // look for. Nothing a reader can do about it, and one line saying so is
        // as much as a list of them would say.
        ctx.report({
          file: template.file,
          line: event.line,
          reason: 'route-link-dynamic',
          level: 'info',
          hint:
            listed === undefined || listed.unread.length === 0
              ? 'The path is built at run time, so no configured route can be matched against it.'
              : `The path is read from what the template reads, and that was not followed: ${listed.unread.join('; ')}.`,
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

    // `(click)="router.navigate(['/queue'])"`: the click shows the screen the route at that address shows, as a link's does (P288).
    const navigating = event.handlers.filter(
      (handler): handler is Extract<TemplateHandler, { kind: 'member' }> =>
        handler.kind === 'member' && NAVIGATING.has(handler.method) && holdsRouterAs(indexed.declaration, handler.property),
    );
    for (const handler of navigating) {
      const landing = {
        from: id,
        file: template.file,
        line: event.line,
        symbol: `${indexed.name} (${event.name})`,
        method: handler.method,
        ensure: () => undefined,
        type: 'triggers' as const,
      };
      // `router.navigate([item.route])` in a loop: one landing per entry of the list it walks (P363).
      const read = handler.address === undefined ? undefined : readAddress(handler.address, { loops: event.loops ?? new Map(), owner: indexed.declaration });
      if (read !== undefined && read.paths.length > 0) {
        for (const path of read.paths) landNavigation(ctx, { ...landing, written: { path } });
        if (read.unread.length > 0) landNavigation(ctx, { ...landing, written: { code: `${handler.args[0] ?? ''} (${read.unread.join('; ')})`.slice(0, 160) } });
        continue;
      }
      const written = writtenOfText(handler.method, handler.args[0]);
      // An address that is nothing but values read at run time names no route to look for: code, with why it was not read.
      const unreadAddress = read !== undefined && 'path' in written && onlyHoles(written.path);
      landNavigation(ctx, { ...landing, written: unreadAddress ? { code: `${handler.args[0] ?? ''}${read.unread.length === 0 ? '' : ` (${read.unread.join('; ')})`}`.slice(0, 160) } : written });
    }
    if (navigating.length > 0 && navigating.length === event.handlers.length) return;

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

    // A name the template bound is not a member of anything. Looking for it on
    // the component finds nothing, and saying so accused every `let-` context
    // field and every `#ref` on a video platform of being a method somebody had
    // deleted - 35 rows, all of them wrong (R105). It is the nothing-to-point-at
    // case, and the row says which local it was so a reader recognises it
    // without opening the template.
    if (only?.kind === 'local') {
      ctx.report({
        file: template.file,
        line: event.line,
        reason: 'handler-not-a-method',
        level: 'nothing',
        hint: `${only.local} is bound by the template itself - a let- context field, a #ref, a @for item, an @if alias or an @let - so no method of ${indexed.name} answers it.`,
        symbol,
      });
      return;
    }

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

  /**
   * A link read over the list it walks (P363): a `triggers` edge to the
   * screen at each address an entry spells, with `meta.listed`; a row for an
   * address no configured route answers, naming it; one for what of the list
   * was not read, saying why.
   */
  const landListed = (indexed: IndexedClass, event: TemplateEvent, template: TemplateText, id: string, listed: ListedReading): void => {
    for (const path of listed.paths) {
      const answering = routesMatching(ctx.routes, path);
      const route = answering.find((candidate) => candidate.component !== undefined);
      const target = route?.component === undefined ? undefined : ctx.classes.get(route.component);
      if (target !== undefined && route !== undefined) {
        ctx.ensureClassNode(target.declaration);
        const stored = ctx.builder.addEdge({
          from: id,
          to: target.id,
          type: 'triggers',
          confidence: 'static',
          file: template.file,
          line: event.line,
          meta: { [NAVIGATES_META]: path, route: route.path, listed: true },
        });
        const firstPath = stored.meta?.[NAVIGATES_META];
        if (typeof firstPath === 'string' && firstPath !== path && stored.meta !== undefined) {
          const also = Array.isArray(stored.meta['alsoNavigates']) ? (stored.meta['alsoNavigates'] as string[]) : [];
          stored.meta = { ...stored.meta, alsoNavigates: [...new Set([...also, path])].sort() };
        }
        continue;
      }
      if (ctx.routes.length === 0) continue;
      ctx.report({
        file: template.file,
        line: event.line,
        reason: answering.length > 0 ? 'route-screen-unread' : 'route-target-unresolved',
        level: answering.length > 0 ? 'info' : 'action',
        hint:
          answering.length > 0
            ? `A route answers ${path}, which an entry of ${listed.lists.join(', ') || 'the list'} names, but nothing in the configuration said which component it shows.`
            : `No configured route answers ${path}, which an entry of ${listed.lists.join(', ') || 'the list'} this link is rendered over names.`,
        symbol: `${indexed.name} ${event.source} -> ${path}`,
      });
    }
    if (listed.unread.length === 0) return;
    ctx.report({
      file: template.file,
      line: event.line,
      reason: 'route-link-dynamic',
      level: 'info',
      hint: `Some of what this link is rendered over was not read: ${listed.unread.join('; ')}.`,
      symbol: `${indexed.name} ${event.source}`,
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

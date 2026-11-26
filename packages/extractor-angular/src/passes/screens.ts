import { addScreenEntry, lineOf } from '@flowatlas/core';
import type { AngularExtractContext, RouteEntry } from '../context.js';
import { definePass } from './types.js';

/** A guard or resolver as the screen's entry lists it: its kind and what is written, cut short. */
const guardSaid = (guard: NonNullable<RouteEntry['guards']>[number]): string =>
  `${guard.kind} ${guard.value.getText().replace(/\s+/g, ' ').slice(0, 60)}`;

/**
 * Every screen the router registers, as a way in (P363): for each route of
 * the configuration that shows a component of the repository - named,
 * loaded lazily, nested in `children` or in a module a `loadChildren`
 * mounts, whatever the route reader resolved - an entry of kind `screen` at
 * the full address it is mounted at, the component behind it, and the
 * guards and resolvers the router runs first listed on it. The component
 * keeps its addresses as `route`, as a page of the other front ends does.
 * A screen no link reaches is still shown at its address, so it is reached:
 * what reaches it says which address, and the links that land on it say
 * which link.
 */
export const screensPass = definePass('screens', (ctx: AngularExtractContext) => {
  const routed = new Map<string, Set<string>>();
  for (const route of ctx.routes) {
    if (route.component === undefined) continue;
    const screen = ctx.classes.get(route.component);
    if (screen === undefined) continue;
    const node = ctx.ensureClassNode(screen.declaration);
    if (node === undefined) continue;
    const site = route.site ?? screen.declaration;
    addScreenEntry(ctx.builder, {
      repo: ctx.repo,
      path: route.path,
      component: node.id,
      label: screen.name,
      file: ctx.fileOf(site),
      line: lineOf(site),
      by: 'angular-routes',
      ...(route.guards === undefined ? {} : { guards: route.guards.filter((guard) => guard.kind !== 'canDeactivate').map(guardSaid) }),
    });
    routed.set(node.id, (routed.get(node.id) ?? new Set()).add(route.path));
  }
  for (const [id, paths] of routed) {
    const node = ctx.builder.getNode(id);
    if (node !== undefined) node.meta = { ...node.meta, route: [...paths].sort().join(' ') };
  }
});

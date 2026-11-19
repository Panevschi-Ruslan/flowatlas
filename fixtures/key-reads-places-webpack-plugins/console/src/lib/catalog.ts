import type { ComponentType } from 'react';
import { Hats, Scarves, Shoes } from '../features/screens';

/** One page of the catalog as its routes hand it. */
export interface CatalogRoute {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Departments kept under a name, each written in place by the adding method from what it is handed. */
export class Catalog {
  departments: Record<string, { readonly Screen: ComponentType; readonly title: string }> = {};

  add(name: string, Screen: ComponentType): void {
    this.departments[name] = { Screen, title: name };
  }

  routes(): CatalogRoute[] {
    return Object.entries(this.departments).map(([name, department]) => ({ path: `/catalog/${name}`, Screen: department.Screen }));
  }
}

export const catalog = new Catalog();
catalog.add('shoes', Shoes);
catalog.add('hats', Hats);

/** Shelves kept in a Map under their address, each written in place by the adding function. */
const shelves = new Map<string, { readonly Screen: ComponentType }>();

export const addShelf = (path: string, Screen: ComponentType): void => {
  shelves.set(path, { Screen });
};

export const shelfRoutes = (): CatalogRoute[] => [...shelves.entries()].map(([path, shelf]) => ({ path, Screen: shelf.Screen }));

addShelf('/shelves/scarves', Scarves);

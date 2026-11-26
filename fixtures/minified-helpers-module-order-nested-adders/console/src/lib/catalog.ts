import type { ComponentType } from 'react';
import { Hats, Home, Sale, Shoes } from '../features/screens';
import type { Page } from './registries';

/** One department as the adding method writes it. */
interface Department {
  readonly Screen: ComponentType;
  readonly title: string;
}

/** Departments kept under a name, each written in place by `add`; the other adding methods hand on their own parameters to it. */
export class Catalog {
  departments: Record<string, Department> = {};

  add(name: string, Screen: ComponentType): void {
    this.departments[name] = { Screen, title: name };
  }

  addHome(Screen: ComponentType): void {
    this.add('home', Screen);
  }

  addSection(slug: string, Screen: ComponentType): void {
    this.add(slug, Screen);
  }

  addSale(Screen: ComponentType): void {
    this.addSection('sale', Screen);
  }

  routes(): Page[] {
    return Object.entries(this.departments).map(([name, department]) => ({ path: `/catalog/${name}`, Screen: department.Screen }));
  }
}

export const catalog = new Catalog();
catalog.add('shoes', Shoes);
catalog.addHome(Home);
catalog.addSection('hats', Hats);
catalog.addSale(Sale);

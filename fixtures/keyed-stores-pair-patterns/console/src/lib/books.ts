import type { ComponentType } from 'react';
import { About, Billing, Exporter, Home, Overview, Settings, Usage, Users } from '../features/screens';
import type { Entry } from './tables';

/** The key the settings page is kept under. */
const SETTINGS_KEY = 'settings';

/** Pages kept under a name, read back as [name, page] pairs. */
export class PageBook {
  pages: Record<string, { readonly Screen: ComponentType }> = { overview: { Screen: Overview } };

  add(name: string, entry: { readonly Screen: ComponentType }): void {
    this.pages[name] = entry;
  }

  addHome(entry: { readonly Screen: ComponentType }): void {
    this.pages['home'] = entry;
  }

  routes(): Entry[] {
    return Object.entries(this.pages).map(([name, page]) => ({ path: `/book/${name}`, Screen: page.Screen }));
  }
}

export const book = new PageBook();
book.add('billing', { Screen: Billing });
book.add(SETTINGS_KEY, { Screen: Settings });
book.addHome({ Screen: Home });

/** Panels kept in a Map under their address, read back through its entries. */
export class PanelMap {
  panels = new Map<string, ComponentType>();

  register(path: string, Screen: ComponentType): void {
    this.panels.set(path, Screen);
  }

  routes(): Entry[] {
    return [...this.panels.entries()].map(([path, Screen]) => ({ path, Screen }));
  }
}

export const panels = new PanelMap();
panels.register('/panels/usage', Usage);

/** Tools kept under a name, read back through their keys. */
export class Toolbox {
  tools: Record<string, ComponentType> = {};

  put(name: string, Screen: ComponentType): void {
    this.tools[name] = Screen;
  }

  routes(): Entry[] {
    return Object.keys(this.tools).map((name) => ({ path: `/tools/${name}`, Screen: this.tools[name] }));
  }
}

export const toolbox = new Toolbox();
toolbox.put('export', Exporter);

/** Lists of entries kept under an area, one looked up by its area. */
export class AreaBook {
  areas: Record<string, Entry[]> = {};

  put(area: string, entries: Entry[]): void {
    this.areas[area] = entries;
  }

  routesOf(area: string): Entry[] {
    return this.areas[area];
  }
}

export const areaBook = new AreaBook();
areaBook.put('admin', [{ path: '/admin/users', Screen: Users }]);
areaBook.put('public', [{ path: '/public/about', Screen: About }]);

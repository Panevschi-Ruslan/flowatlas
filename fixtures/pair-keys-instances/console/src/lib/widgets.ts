import { Chart, Gauge, Hidden } from '../features/screens';
import type { Entry } from './tables';

/** The widgets installed, kept in an instance's field. */
export class WidgetRegistry {
  items: Entry[] = [];

  routes(): Entry[] {
    return this.items;
  }
}

/** The console's widgets, its gadgets, and a registry nobody shows. */
export const widgets = new WidgetRegistry();
export const gadgets = new WidgetRegistry();
export const spares = new WidgetRegistry();

/** Installs the widget handed beside the registry, in one object. */
export function install({ registry, widget }: { registry: WidgetRegistry; widget: Entry }): void {
  registry.items.push(widget);
}

install({ registry: widgets, widget: { path: '/widgets/chart', Screen: Chart } });
install({ registry: gadgets, widget: { path: '/gadgets/gauge', Screen: Gauge } });
install({ registry: spares, widget: { path: '/spares/hidden', Screen: Hidden } });

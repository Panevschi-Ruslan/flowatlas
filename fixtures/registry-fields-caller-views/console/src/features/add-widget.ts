import { WidgetRegistry, type Widget } from '../lib/widgets';

/** Adds a widget, from a module other than the class's. */
export function addWidget(widget: Widget): void {
  WidgetRegistry.items.push(widget);
}

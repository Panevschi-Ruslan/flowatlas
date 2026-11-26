import type { ComponentType } from 'react';

/** One widget: its address under the widgets, and its screen. */
export interface Widget {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** The widgets installed, kept in a static field other modules add to. */
export class WidgetRegistry {
  static items: Widget[] = [];

  /** Each widget at its address under the widgets. */
  static routes(): Widget[] {
    return this.items.map((widget) => ({ ...widget, path: `/widgets${widget.path}` }));
  }
}

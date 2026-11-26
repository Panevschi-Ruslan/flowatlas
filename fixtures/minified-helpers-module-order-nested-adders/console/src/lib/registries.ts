import type { ComponentType } from 'react';
import { Welcome } from '../features/screens';

/** One step: the screen it shows. */
export interface Step {
  readonly Screen: ComponentType;
}

/** One page of a route table. */
export interface Page {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Steps kept in a list in the order they are added, the first written in place; read back as [place, step] pairs. */
export class StepBook {
  items: Step[] = [{ Screen: Welcome }];

  add(step: Step): void {
    this.items.push(step);
  }

  routes(): Page[] {
    return [...this.items.entries()].map(([at, step]) => ({ path: `/steps/${at}`, Screen: step.Screen }));
  }
}

export const steps = new StepBook();

/** Panels kept in a module's list, pushed onto from other modules. */
export const panels: Step[] = [];

/** Tours kept by functions, one module adding to them reached only through a dynamic import. */
const tourList: Step[] = [];

export const addTour = (step: Step): void => {
  tourList.push(step);
};

export const tourRoutes = (): Page[] => [...tourList.entries()].map(([at, step]) => ({ path: `/tours/${at}`, Screen: step.Screen }));

/** Widgets kept by functions, added to by modules two entry points import. */
const widgetList: Step[] = [];

export const addWidget = (step: Step): void => {
  widgetList.push(step);
};

export const widgetRoutes = (): Page[] => [...widgetList.entries()].map(([at, step]) => ({ path: `/widgets/${at}`, Screen: step.Screen }));

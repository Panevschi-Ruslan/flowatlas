import type { ComponentType, ReactElement } from 'react';
import {
  About,
  Billing,
  Finish,
  Home,
  Importer,
  Pricing,
  Profile,
  Review,
  Search,
  Support,
  Team,
  Welcome,
} from '../features/screens';

/** One step of a wizard: the screen it shows. */
export interface Step {
  readonly Screen: ComponentType;
}

/** Pages kept under their address, each an element: read through Object.keys and looked up by the key. */
export const PAGES: Record<string, ReactElement> = {
  '/home': <Home />,
  '/about': <About />,
};

/** Tools kept under a name, each an element. */
export const TOOLS: Record<string, ReactElement> = {
  import: <Importer />,
};

/** Shortcuts the navigation links to, each under its address. */
export const SHORTCUTS: Record<string, string> = {
  '/home': 'Home',
  '/about': 'About',
};

/** Areas kept under a slug, each naming its screen two keys down. */
export const AREAS: Record<string, { readonly meta: { readonly view: { readonly Screen: ComponentType } } }> = {
  pricing: { meta: { view: { Screen: Pricing } } },
};

/** Links, each naming its screen one key down. */
export const LINKS = [{ to: '/team', view: { Screen: Team } }];

/** Billing kept under a slug, its screen one key down. */
export const SECTIONS: Record<string, { readonly meta: { readonly Screen: ComponentType } }> = {
  billing: { meta: { Screen: Billing } },
};

const FIRST: Step[] = [{ Screen: Welcome }, { Screen: Profile }];

/** A list spread from a list written in place, then one more step: places 0, 1, 2. */
export const STEPS: Step[] = [...FIRST, { Screen: Finish }];

/** A list concatenated: places 0, 1, 2. */
export const STAGES: Step[] = FIRST.concat([{ Screen: Review }]);

/** A list mapped from one written in place: each object at its item's place. */
export const FLOW: Step[] = [Welcome, Finish].map((Screen) => ({ Screen }));

/** A list a function hands back, written in place there. */
export const tourSteps = (): Step[] => [{ Screen: Search }, { Screen: Support }];

/** A list read at run time, spread after one written in place: the places past it are not known. */
const remote = (globalThis as unknown as { readonly steps: Step[] }).steps;
export const LATE: Step[] = [{ Screen: Welcome }, ...remote];

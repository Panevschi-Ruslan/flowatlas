import type { ComponentType } from 'react';
import { Extra, Finish, Guide, Help, Pricing, Reference, Welcome } from '../features/screens';

/** One entry of a list the console's routes are built from. */
export interface Entry {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Sections kept under a slug, each under the base it writes, or the docs. */
export const SECTIONS: Record<string, { readonly Screen: ComponentType; readonly base?: string }> = {
  guide: { Screen: Guide },
  reference: { Screen: Reference, base: '/guides' },
};

/** Areas kept under a slug, each naming its screen in its meta. */
export const AREAS: Record<string, { readonly meta: { readonly Screen: ComponentType } }> = {
  pricing: { meta: { Screen: Pricing } },
};

/** Links, each an object written in place. */
export const LINKS = [{ to: '/links/help', Screen: Help }];

/** The wizard's steps, in order. */
export const WIZARD = [Welcome, Finish];

/** An entry made by a function: not written in place. */
export const extraEntry = (path: string): Entry => ({ path, Screen: Extra });

export const EXTRA_A = [extraEntry('/extra/a')];
export const EXTRA_B = [extraEntry('/extra/b')];
export const EXTRA_C = [extraEntry('/extra/c')];
export const EXTRA_D = [extraEntry('/extra/d')];

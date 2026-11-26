import type { ComponentType } from 'react';

/** One section of the console. */
export interface Section {
  readonly path: string;
  readonly Screen: ComponentType;
}

/** The sections, a store this module keeps; classes of other modules add to it. */
export const sections: Section[] = [];

/** Every section. */
export function listSections(): Section[] {
  return sections;
}

import type { ComponentType } from 'react';

/** A settings screen an installed extension adds, known only when the wiki runs. */
export interface Extension {
  readonly id: string;
  readonly name: string;
  readonly component: ComponentType;
}

/** The extensions installed, filled in when the wiki starts. */
export const installed: Extension[] = [];

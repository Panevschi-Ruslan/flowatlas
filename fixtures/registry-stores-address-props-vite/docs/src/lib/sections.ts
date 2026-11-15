import type { ComponentType } from 'react';

/** One section of the docs: the area it belongs to, its address and its screen. */
export interface Section {
  readonly area: string;
  readonly path: string;
  readonly Screen: ComponentType;
}

/** Every section added, filed by its area: a store the module keeps. */
const sections = new Map<string, Section[]>();

/** Adds one section under its area. */
export function registerSection(section: Section): void {
  const list = sections.get(section.area) ?? [];
  list.push(section);
  sections.set(section.area, list);
}

/** The sections of one area, in the order they were added. */
export function sectionsOf(area: string): Section[] {
  return sections.get(area) ?? [];
}

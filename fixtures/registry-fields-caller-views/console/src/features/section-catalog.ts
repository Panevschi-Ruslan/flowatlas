import { sections, type Section } from '../lib/sections';

/** Adds sections through a static method. */
export class SectionCatalog {
  static register(section: Section): void {
    sections.push(section);
  }
}

/** Adds sections through an instance's method, the instance a `const` holds. */
export class SectionBook {
  add(section: Section): void {
    this.keep(section);
  }

  private keep(section: Section): void {
    sections.push(section);
  }
}

export const book = new SectionBook();

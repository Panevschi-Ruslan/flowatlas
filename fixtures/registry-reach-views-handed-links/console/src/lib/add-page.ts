import { pages, type Page } from './pages';

/** Adds a page under its address, from a module other than the one keeping the store. */
export function addPage(page: Page): void {
  pages.set(page.path, page);
}

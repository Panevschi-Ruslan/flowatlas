/**
 * Colour, written out rather than depended on.
 *
 * Four escape codes and a lookup table do everything a terminal needs here, and
 * a query command that prints one tree should not pull a package in to do it.
 */
export type Paint = (text: string) => string;

const sgr = (code: string): Paint => (text) => `\u001B[${code}m${text}\u001B[0m`;

export const plain: Paint = (text) => text;

export const dim = sgr('2');
export const bold = sgr('1');
export const warn = sgr('33');

/**
 * One colour per repository, six of them, wrapping.
 *
 * Assigned by the order services are declared in, so the same project always
 * paints the same way and two screenshots can be compared.
 */
export const REPO_COLORS = ['36', '35', '32', '33', '34', '31'] as const;

export interface RepoPalette {
  /** How to paint anything belonging to a service. */
  of(service: string | undefined): Paint;
}

export const noPalette: RepoPalette = { of: () => plain };

export const repoPalette = (services: readonly string[], color: boolean): RepoPalette => {
  if (!color) return noPalette;
  const paints = new Map<string, Paint>();
  services.forEach((service, index) => {
    paints.set(service, sgr(REPO_COLORS[index % REPO_COLORS.length] as string));
  });
  return { of: (service) => (service === undefined ? plain : (paints.get(service) ?? plain)) };
};

const ANSI = /\u001B\[[0-9;]*m/g;

/** The text without its escape codes, which is what a column width is about. */
export const uncolored = (text: string): string => text.replace(ANSI, '');

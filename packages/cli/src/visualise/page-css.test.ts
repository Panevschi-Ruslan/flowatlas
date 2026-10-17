import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastOf } from './frame.js';

/**
 * The page's colours and sizes, read from `page.css` itself (P102): every
 * colour that writes text reads at 4.5:1 or more on every ground it is
 * written on, in both themes, and no text is under 12px outside the
 * drawings' own list. A browser is not needed for either: the ratios are
 * worked out from the tokens, the sizes read from the rules.
 */
const css = readFileSync(new URL('./page.css', import.meta.url), 'utf8');

/** The `--name: value` pairs of the first block opened by `opening`. */
const tokensOf = (opening: string): Map<string, string> => {
  const at = css.indexOf(opening);
  if (at < 0) throw new Error(`page.css has no ${opening}`);
  const block = css.slice(at + opening.length, css.indexOf('}', at));
  return new Map([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));
};

const THEMES = {
  light: tokensOf(':root {'),
  dark: tokensOf(":root[data-theme='dark'] {"),
  'dark, by the system': tokensOf(":root:not([data-theme='light']) {"),
};

/** The colours text is written in, and the grounds it is written on. */
const TEXT = ['ink', 'muted', 'faint', 'accent', 'good', 'warn', 'bad', 's-0', 's-1', 's-2', 's-3', 's-4'];
const GROUNDS = ['ground', 'paper', 'raise', 'accent-soft'];
/** What a hue fills under text written in --raise: a glyph, a badge. */
const FILLS = ['bad', 'warn', 's-0', 's-1', 's-2', 's-3', 's-4'];

describe('the page’s colours', () => {
  it('are the same dark theme whether the system or the toggle asks for it', () => {
    expect(Object.fromEntries(THEMES['dark, by the system'])).toEqual(Object.fromEntries(THEMES.dark));
  });

  for (const [theme, tokens] of Object.entries(THEMES)) {
    const colour = (name: string): string => {
      const value = tokens.get(name);
      if (value === undefined) throw new Error(`the ${theme} theme has no --${name}`);
      return value;
    };

    it(`write text at 4.5:1 or more on every ground, in the ${theme} theme`, () => {
      const low = TEXT.flatMap((fg) => GROUNDS.map((bg) => ({ fg, bg, ratio: contrastOf(colour(fg), colour(bg)) })))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ fg, bg, ratio }) => `--${fg} on --${bg}: ${ratio.toFixed(2)}`);
      expect(low).toEqual([]);
    });

    it(`keep --muted clear of the line on --ground, and --raise readable on a hue, in the ${theme} theme`, () => {
      expect(contrastOf(colour('muted'), colour('ground'))).toBeGreaterThanOrEqual(5);
      // Hints are --faint, quieter than --muted, never louder.
      expect(contrastOf(colour('faint'), colour('paper'))).toBeLessThan(contrastOf(colour('muted'), colour('paper')));
      const low = FILLS.filter((fill) => contrastOf(colour('raise'), colour(fill)) < 4.5);
      expect(low).toEqual([]);
    });

    it(`draw the tones at 3:1 or more as graphics, in the ${theme} theme`, () => {
      const low = FILLS.concat('good', 'accent').filter((tone) =>
        ['ground', 'paper', 'raise'].some((bg) => contrastOf(colour(tone), colour(bg)) < 3));
      expect(low).toEqual([]);
    });
  }

  it('let form controls follow the theme', () => {
    expect(css).toMatch(/:root \{\n {2}color-scheme: light dark;/);
    expect(css).toContain(":root[data-theme='light'] { color-scheme: light; }");
    expect(css).toMatch(/:root\[data-theme='dark'\] \{\n {2}color-scheme: dark;/);
  });
});

describe('the page’s text sizes', () => {
  /** Every rule as its selector and its declarations, in the order written. */
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim().replace(/\s+/g, ' '), body: body! }));
  const allowed = /small-text: ([^\n*]+)/.exec(css)![1]!.split('|').map((selector) => selector.trim());

  it('are 12px or more, but for the drawings’ own list', () => {
    const small = rules.flatMap(({ selector, body }) => [...body.matchAll(/font-size:\s*([\d.]+)px/g)]
      .filter(([, size]) => Number(size) < 12).map(([, size]) => ({ selector, size: Number(size) })));
    expect(small.filter(({ selector }) => !allowed.includes(selector))).toEqual([]);
    expect(small.length).toBeGreaterThan(0);
  });

  it('allow smaller only inside a drawing, and every name in the list is a rule', () => {
    for (const selector of allowed) {
      expect(rules.some((rule) => rule.selector === selector), selector).toBe(true);
      // The drawings' parts: the graph's (.g-…) and the map's (.m-…) SVG.
      expect(selector, selector).toMatch(/^\.(?:g|m)-[\w-]+(?: text)?$/);
    }
    // A name at zoom 1 is never in it.
    expect(allowed).not.toContain('.g-label');
    expect(allowed).not.toContain('.m-name');
  });
});

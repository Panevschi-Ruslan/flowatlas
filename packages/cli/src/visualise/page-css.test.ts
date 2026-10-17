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

describe('the page’s chip rows (P137)', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim().replace(/\s+/g, ' '), body: body! }));
  /** Every declaration written for `selector`, the later over the earlier. */
  const declared = (selector: string): Map<string, string> => new Map(rules.filter((rule) => rule.selector === selector)
    .flatMap((rule) => [...rule.body.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)].map(([, name, value]) => [name!, value!.trim()])));
  const html = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

  it('lay the Map’s kinds of link out as a row that wraps, and keep the Graph’s Filters a column', () => {
    const kinds = /<span id="m-kinds"[^>]*>/.exec(html)![0];
    expect(kinds).toContain('class="m-kinds"');
    expect(kinds).not.toContain('g-filters');
    const row = declared('.m-kinds');
    expect(row.get('display')).toMatch(/flex/);
    expect(row.get('flex-flow')).toBe('row wrap');
    expect(declared('.g-filters').get('flex-direction')).toBe('column');
  });

  it('wrap the Ways in list’s failures line a whole chip at a time, never cut mid-word', () => {
    expect(declared('.list li.v-row .row-fails').get('white-space')).toBe('normal');
    expect(declared('.list li.v-row .row-fails .fail-chips').get('flex-wrap')).toBe('wrap');
    expect(declared('.list li.v-row .fail-chip').get('white-space')).toBe('nowrap');
    expect(rules.some((rule) => rule.selector.endsWith('.fail-chips') && /flex-wrap:\s*nowrap/.test(rule.body))).toBe(false);
  });
});

describe('the page’s control edges (P142)', () => {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector!.trim().replace(/\s+/g, ' '), body: body! }));
  const ruleOf = (selector: string): { selector: string; body: string } => {
    const rule = rules.find((one) => one.selector === selector);
    if (rule === undefined) throw new Error(`page.css has no rule for ${selector}`);
    return rule;
  };
  /** What a control is drawn as: the last part of one of its selectors names it. */
  const CONTROL = /^(?:input(?!\[type=.(?:checkbox|radio).\])|select|kbd|\.(?:tool|chip|tab|ship|pill|find-key|g-more-btn|g-type-all|g-fold|row-menu-btn))(?![\w-])/;
  const isControl = (selector: string): boolean =>
    selector.split(',').some((one) => CONTROL.test(one.trim().split(/[\s>+~]+/).pop()!));
  /** The colours an edge, a ring or a mark may be drawn in, each held at 3:1 below. */
  const EDGES = ['edge', 'accent', 'faint', 'ink'];
  /** A border or outline property, its radius aside. */
  const BORDER = /border(?:-(?![\w-]*radius)[\w-]+)?|outline(?:-color)?/;
  /** The tokens named by the declarations of `body` whose property matches `property`. */
  const tokensIn = (body: string, property: RegExp): string[] =>
    [...body.matchAll(new RegExp(`(?:^|[;\\s])(?:${property.source})\\s*:([^;]*)`, 'g'))]
      .flatMap(([, value]) => [...value!.matchAll(/var\(--([\w-]+)/g)].map(([, name]) => name!));

  for (const [theme, tokens] of Object.entries(THEMES)) {
    const colour = (name: string): string => {
      const value = tokens.get(name);
      if (value === undefined) throw new Error(`the ${theme} theme has no --${name}`);
      return value;
    };

    it(`are 3:1 or more on --ground, --paper and --raise, as are rings and marks, in the ${theme} theme`, () => {
      const low = EDGES.flatMap((edge) => ['ground', 'paper', 'raise'].map((bg) => ({ edge, bg, ratio: contrastOf(colour(edge), colour(bg)) })))
        .filter(({ ratio }) => ratio < 3)
        .map(({ edge, bg, ratio }) => `--${edge} on --${bg}: ${ratio.toFixed(2)}`);
      expect(low).toEqual([]);
      // The accent bar marks a pick on its soft fill as well.
      expect(contrastOf(colour('accent'), colour('accent-soft'))).toBeGreaterThanOrEqual(3);
      // The rules stay quiet: the edge, louder than them, is what tells a control.
      expect(contrastOf(colour('edge'), colour('paper'))).toBeGreaterThan(contrastOf(colour('rule'), colour('paper')));
    });
  }

  it('draw every control’s edge in --edge, a state in a 3:1 colour, and never in --rule', () => {
    const controls = rules.filter(({ selector }) => isControl(selector));
    expect(controls.length).toBeGreaterThan(10);
    const drawn = controls.flatMap(({ selector, body }) =>
      tokensIn(body, BORDER).map((token) => ({ selector, token })));
    // A service's hue (--hue), a kind of link's (--kind, a hue, --muted, --faint or the accent)
    // and --good are held at 3:1 by the tones test.
    expect(drawn.filter(({ token }) => !EDGES.includes(token) && !['hue', 'kind', 'good'].includes(token))).toEqual([]);
    for (const control of ["input[type='search'], select", '.tool', '.chip', '.tab', '.ship', 'kbd', '.pill', '.finder input']) {
      expect(tokensIn(ruleOf(control).body, BORDER), control).toContain('edge');
    }
    // The frames and rules that only decorate keep --rule.
    expect(tokensIn(ruleOf('.panel').body, BORDER)).toEqual(['rule']);
  });

  it('ring a focus in the accent, and mark a focus or a pick that has no ring with an accent bar', () => {
    const outlines = rules.flatMap(({ selector, body }) => [...body.matchAll(/(?:^|[;\s])outline\s*:([^;]*)/g)]
      .map(([, value]) => ({ selector, value: value!.trim() })))
      .filter(({ value }) => value !== 'none');
    expect(outlines.length).toBeGreaterThan(5);
    expect(outlines.filter(({ value }) => !/^\d+px solid var\(--accent\)$/.test(value))).toEqual([]);
    expect(ruleOf(':focus-visible').body).toMatch(/outline:\s*2px solid var\(--accent\)/);
    // A row focused or picked by a fill alone reads at under 3:1 on its panel: every
    // focus or pick without a ring draws the accent, the rows as a bar along their start.
    const filled = rules.filter(({ selector, body }) =>
      /:focus\b|\[aria-selected='true'\]/.test(selector) && /background\s*:/.test(body) &&
      !/(?:^|[;\s])outline\s*:\s*\d/.test(body));
    expect(filled.filter(({ body }) => !/var\(--accent\)/.test(body)).map(({ selector }) => selector)).toEqual([]);
    const bars = filled.filter(({ body }) => /box-shadow:\s*inset 3px 0 0 var\(--accent\)/.test(body)).map(({ selector }) => selector);
    expect(bars).toEqual(expect.arrayContaining(['.find-out a:focus', ".row-menu-list [role='menuitem']:focus", ".palette-list [role='option'][aria-selected='true']"]));
    expect(tokensIn(ruleOf(".tab[aria-selected='true']").body, /border-color/)).toEqual(['accent']);
  });
});

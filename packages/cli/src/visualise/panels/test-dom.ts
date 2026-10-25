/**
 * A small document for the page's tests (P103): enough of the DOM for the
 * panels to set themselves up and draw - elements, text, markup in and out,
 * the selectors the page uses, events that bubble - and nothing it does not
 * use. No layout: every size is 0, so whatever the page measures falls back
 * to its defaults, the same way the page does before the window has a size.
 *
 * The workspace installs nothing for a test DOM, and a whole browser engine
 * would be a large dependency for checking what a panel writes; this is a few
 * hundred lines the page's own tests own.
 */

type Listener = (event: any) => unknown;
type Parent = FakeElement | FakeFragment | FakeDocument;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
/** An open tag that closes the one before it when they are siblings: `<li>a<li>b`. */
const CLOSES: Record<string, ReadonlySet<string>> = {
  li: new Set(['li']), option: new Set(['option']), p: new Set(['p']), dt: new Set(['dt', 'dd']),
  dd: new Set(['dt', 'dd']), tr: new Set(['tr', 'td', 'th']), td: new Set(['td', 'th']), th: new Set(['td', 'th']),
};
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rarr: '→',
  larr: '←', harr: '↔', darr: '↓', uarr: '↑', times: '×', mdash: '—',
  ndash: '–', minus: '−', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“',
  rdquo: '”', lambda: 'λ', copy: '©', laquo: '«', raquo: '»',
};
const decode = (text: string): string => text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ENTITIES[name] ?? whole;
});
const escText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const camel = (name: string): string => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class FakeEvent {
  type: string;
  bubbles: boolean;
  defaultPrevented = false;
  stopped = false;
  target: any = null;
  currentTarget: any = null;
  [key: string]: any;
  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    Object.assign(this, { key: '', button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, ...init });
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.stopped = true; }
}

class Target {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  /** Calls this target's own listeners; bubbling is the node's. */
  hear(event: FakeEvent): void {
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
  }
}

export class FakeNode extends Target {
  parentNode: Parent | null = null;
  childNodes: FakeNode[] = [];
  doc: FakeDocument;
  constructor(doc: FakeDocument) { super(); this.doc = doc; }
  get ownerDocument(): FakeDocument { return this.doc; }
  get parentElement(): FakeElement | null { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); if (value !== '') this.append(String(value)); }
  get children(): FakeElement[] { return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement); }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  get lastElementChild(): FakeElement | null { return this.children.at(-1) ?? null; }
  private sibling(step: number): FakeElement | null {
    const list = this.parentNode ? this.parentNode.children : [];
    const at = list.indexOf(this as unknown as FakeElement);
    return at < 0 ? null : list[at + step] ?? null;
  }
  get nextElementSibling(): FakeElement | null { return this.sibling(1); }
  get previousElementSibling(): FakeElement | null { return this.sibling(-1); }
  /** Nodes, strings as text, a fragment as its children. */
  protected adopt(items: unknown[]): FakeNode[] {
    return items.flatMap((item) => {
      if (item instanceof FakeFragment) { const kids = [...item.childNodes]; item.childNodes = []; return kids; }
      if (item instanceof FakeNode) { item.remove(); return [item]; }
      return [new FakeText(this.doc, String(item))];
    });
  }
  insertAt(index: number, items: unknown[]): void {
    const nodes = this.adopt(items);
    for (const node of nodes) node.parentNode = this as unknown as Parent;
    this.childNodes.splice(index, 0, ...nodes);
  }
  append(...items: unknown[]): void { this.insertAt(this.childNodes.length, items); }
  prepend(...items: unknown[]): void { this.insertAt(0, items); }
  appendChild<T>(node: T): T { this.append(node); return node; }
  insertBefore<T>(node: T, before: FakeNode | null): T {
    const at = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    this.insertAt(at < 0 ? this.childNodes.length : at, [node]);
    return node;
  }
  removeChild<T extends FakeNode>(node: T): T { node.remove(); return node; }
  replaceChildren(...items: unknown[]): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...items);
  }
  remove(): void {
    if (this.parentNode === null) return;
    const list = this.parentNode.childNodes;
    list.splice(list.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(other: unknown): boolean {
    for (let at = other as FakeNode | null; at; at = at.parentNode as FakeNode | null) if (at === this) return true;
    return false;
  }
  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeNode): void => {
      for (const child of node.childNodes) {
        if (child instanceof FakeElement) { out.push(child); walk(child); }
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const list = parseSelectors(selector);
    return this.descendants().filter((el) => list.some((complex) => matchComplex(el, complex, this)));
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  getElementById(id: string): FakeElement | null { return this.descendants().find((el) => el.getAttribute('id') === id) ?? null; }
  dispatchEvent(event: FakeEvent): boolean {
    event.target = this;
    const path: Target[] = [];
    for (let at: FakeNode | null = this; at; at = at.parentNode as FakeNode | null) path.push(at);
    if (path.at(-1) instanceof FakeDocument) path.push(this.doc.defaultView);
    for (const target of event.bubbles ? path : path.slice(0, 1)) {
      target.hear(event);
      if (event.stopped) break;
    }
    return !event.defaultPrevented;
  }
  cloneNode(deep = false): FakeNode {
    const copy = this.shallow();
    if (deep) copy.append(...this.childNodes.map((child) => child.cloneNode(true)));
    return copy;
  }
  protected shallow(): FakeNode { return new FakeFragment(this.doc); }
  get innerHTML(): string { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html: string) { this.replaceChildren(...parseHtml(this.doc, String(html))); }
}

export class FakeText extends FakeNode {
  data: string;
  constructor(doc: FakeDocument, data: string) { super(doc); this.data = data; }
  override get textContent(): string { return this.data; }
  override set textContent(value: string) { this.data = String(value); }
  protected override shallow(): FakeNode { return new FakeText(this.doc, this.data); }
}

export class FakeComment extends FakeNode {
  data: string;
  constructor(doc: FakeDocument, data: string) { super(doc); this.data = data; }
  override get textContent(): string { return ''; }
  protected override shallow(): FakeNode { return new FakeComment(this.doc, this.data); }
}

export class FakeFragment extends FakeNode {}

const styleOf = (el: FakeElement): Map<string, string> => new Map((el.getAttribute('style') ?? '').split(';')
  .map((rule) => rule.trim()).filter(Boolean)
  .map((rule) => [rule.slice(0, rule.indexOf(':')).trim(), rule.slice(rule.indexOf(':') + 1).trim()] as [string, string]));
const writeStyle = (el: FakeElement, rules: Map<string, string>): void => {
  const text = [...rules].filter(([, value]) => value !== '').map(([name, value]) => `${name}: ${value}`).join('; ');
  if (text === '') el.removeAttribute('style'); else el.setAttribute('style', text);
};

/** Properties a page sets as properties and the DOM keeps as attributes. */
const REFLECTED = ['id', 'title', 'href', 'download', 'src', 'placeholder', 'type', 'name', 'role', 'rel'];

export class FakeElement extends FakeNode {
  readonly localName: string;
  readonly namespaceURI: string;
  attrs = new Map<string, string>();
  scrollTop = 0;
  scrollLeft = 0;
  private ownValue: string | undefined;
  private ownChecked: boolean | undefined;
  private ownSelected: boolean | undefined;
  constructor(doc: FakeDocument, name: string, namespace = 'http://www.w3.org/1999/xhtml') {
    super(doc);
    this.namespaceURI = namespace;
    this.localName = namespace.endsWith('/svg') ? name : name.toLowerCase();
    for (const prop of REFLECTED) {
      Object.defineProperty(this, prop, {
        get: () => this.getAttribute(prop) ?? '',
        set: (value: unknown) => this.setAttribute(prop, String(value)),
        configurable: true,
      });
    }
  }
  get tagName(): string { return this.namespaceURI.endsWith('/svg') ? this.localName : this.localName.toUpperCase(); }
  get nodeName(): string { return this.tagName; }
  getAttribute(name: string): string | null { return this.attrs.get(name.toLowerCase()) ?? null; }
  setAttribute(name: string, value: unknown): void { this.attrs.set(name.toLowerCase(), String(value)); }
  removeAttribute(name: string): void { this.attrs.delete(name.toLowerCase()); }
  hasAttribute(name: string): boolean { return this.attrs.has(name.toLowerCase()); }
  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, ''); else this.removeAttribute(name);
    return on;
  }
  get attributes(): { name: string; value: string }[] { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get className(): string { return this.getAttribute('class') ?? ''; }
  set className(value: string) { this.setAttribute('class', value); }
  get classList() {
    const names = (): string[] => this.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]): void => { this.className = [...new Set(list)].join(' '); };
    return {
      contains: (name: string) => names().includes(name),
      add: (...add: string[]) => write([...names(), ...add]),
      remove: (...drop: string[]) => write(names().filter((name) => !drop.includes(name))),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !names().includes(name);
        write(on ? [...names(), name] : names().filter((n) => n !== name));
        return on;
      },
    };
  }
  get dataset(): Record<string, string | undefined> {
    return new Proxy({}, {
      get: (_, key) => (typeof key === 'string' ? this.getAttribute('data-' + kebab(key)) ?? undefined : undefined),
      set: (_, key, value) => { this.setAttribute('data-' + kebab(String(key)), String(value)); return true; },
      has: (_, key) => this.hasAttribute('data-' + kebab(String(key))),
      deleteProperty: (_, key) => { this.removeAttribute('data-' + kebab(String(key))); return true; },
      ownKeys: () => [...this.attrs.keys()].filter((name) => name.startsWith('data-')).map((name) => camel(name.slice(5))),
      getOwnPropertyDescriptor: (_, key) => (this.hasAttribute('data-' + kebab(String(key)))
        ? { enumerable: true, configurable: true, value: this.getAttribute('data-' + kebab(String(key))) } : undefined),
    });
  }
  get style(): Record<string, any> {
    const methods = {
      setProperty: (name: string, value: unknown) => { const rules = styleOf(this); rules.set(name, String(value)); writeStyle(this, rules); },
      getPropertyValue: (name: string) => styleOf(this).get(name) ?? '',
      removeProperty: (name: string) => { const rules = styleOf(this); rules.delete(name); writeStyle(this, rules); },
    };
    return new Proxy(methods, {
      get: (target, key) => {
        if (typeof key !== 'string') return undefined;
        if (key in target) return (target as any)[key];
        if (key === 'cssText') return this.getAttribute('style') ?? '';
        return styleOf(this).get(kebab(key)) ?? '';
      },
      set: (_, key, value) => {
        if (key === 'cssText') this.setAttribute('style', String(value));
        else methods.setProperty(kebab(String(key)), value);
        return true;
      },
    });
  }
  get hidden(): boolean { return this.hasAttribute('hidden'); }
  set hidden(on: boolean) { this.toggleAttribute('hidden', Boolean(on)); }
  /** A `<details>` opened or closed, and told so by a `toggle` event, as a browser tells it. */
  get open(): boolean { return this.hasAttribute('open'); }
  set open(on: boolean) {
    if (this.hasAttribute('open') === Boolean(on)) return;
    this.toggleAttribute('open', Boolean(on));
    this.dispatchEvent(new FakeEvent('toggle', { bubbles: false }));
  }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(on: boolean) { this.toggleAttribute('disabled', Boolean(on)); }
  get tabIndex(): number { return Number(this.getAttribute('tabindex') ?? -1); }
  set tabIndex(value: number) { this.setAttribute('tabindex', String(value)); }
  get checked(): boolean { return this.ownChecked ?? this.hasAttribute('checked'); }
  set checked(on: boolean) { this.ownChecked = Boolean(on); }
  get selected(): boolean { return this.ownSelected ?? this.hasAttribute('selected'); }
  set selected(on: boolean) { this.ownSelected = Boolean(on); }
  get options(): FakeElement[] { return this.querySelectorAll('option'); }
  get value(): string {
    if (this.localName === 'select') {
      const options = this.options;
      const chosen = options.find((option) => option.selected) ?? options[0];
      return chosen ? chosen.value : '';
    }
    if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent;
    if (this.localName === 'textarea') return this.ownValue ?? this.textContent;
    return this.ownValue ?? this.getAttribute('value') ?? '';
  }
  set value(value: string) {
    if (this.localName === 'select') {
      for (const option of this.options) option.selected = option.value === String(value);
    } else if (this.localName === 'option') this.setAttribute('value', String(value));
    else this.ownValue = String(value);
  }
  get isContentEditable(): boolean { return false; }
  get clientWidth(): number { return 0; }
  get clientHeight(): number { return 0; }
  get offsetWidth(): number { return 0; }
  get offsetHeight(): number { return 0; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getBBox() { return { x: 0, y: 0, width: 0, height: 0 }; }
  scrollIntoView(): void {}
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  select(): void {}
  focus(): void {
    const before = this.doc.activeElement;
    if (before === this) return;
    this.doc.activeElement = this;
    if (before instanceof FakeElement) before.dispatchEvent(new FakeEvent('focusout', { relatedTarget: this }));
    this.dispatchEvent(new FakeEvent('focusin', { relatedTarget: before }));
  }
  blur(): void {
    if (this.doc.activeElement !== this) return;
    this.doc.activeElement = this.doc.body;
    this.dispatchEvent(new FakeEvent('focusout', { relatedTarget: null }));
  }
  click(): void {
    // A summary's click opens or closes its details, unless a listener prevented it.
    if (!this.dispatchEvent(new FakeEvent('click'))) return;
    const parent = this.parentElement;
    if (this.localName === 'summary' && parent !== null && parent.localName === 'details') parent.open = !parent.open;
  }
  matches(selector: string): boolean { return parseSelectors(selector).some((complex) => matchComplex(this, complex, null)); }
  closest(selector: string): FakeElement | null {
    const list = parseSelectors(selector);
    for (let at: FakeNode | null = this; at instanceof FakeElement; at = at.parentNode as FakeNode | null) {
      if (list.some((complex) => matchComplex(at as FakeElement, complex, null))) return at;
    }
    return null;
  }
  insertAdjacentHTML(where: string, html: string): void {
    const nodes = parseHtml(this.doc, html);
    const parent = this.parentNode;
    if (where === 'afterbegin') this.prepend(...nodes);
    else if (where === 'beforeend') this.append(...nodes);
    else if (parent !== null) {
      const at = parent.childNodes.indexOf(this);
      parent.insertAt(where === 'beforebegin' ? at : at + 1, nodes);
    }
  }
  get outerHTML(): string { return serialize(this); }
  protected override shallow(): FakeNode {
    const copy = new FakeElement(this.doc, this.localName, this.namespaceURI);
    for (const [name, value] of this.attrs) copy.attrs.set(name, value);
    return copy;
  }
}

export class FakeDocument extends FakeNode {
  activeElement: FakeElement | null = null;
  title = '';
  defaultView: any = null;
  readonly documentElement: FakeElement;
  constructor() {
    super(null as unknown as FakeDocument);
    this.doc = this;
    this.documentElement = new FakeElement(this, 'html');
    this.append(this.documentElement);
    this.documentElement.append(new FakeElement(this, 'head'), new FakeElement(this, 'body'));
  }
  get body(): FakeElement { return this.documentElement.children[1] as FakeElement; }
  get head(): FakeElement { return this.documentElement.children[0] as FakeElement; }
  createElement(name: string): FakeElement { return new FakeElement(this, name); }
  createElementNS(namespace: string, name: string): FakeElement { return new FakeElement(this, name, namespace); }
  createTextNode(text: string): FakeText { return new FakeText(this, text); }
  createDocumentFragment(): FakeFragment { return new FakeFragment(this); }
  execCommand(): boolean { return false; }
}

const serialize = (node: FakeNode): string => {
  if (node instanceof FakeText) {
    const parent = node.parentNode;
    return parent instanceof FakeElement && RAW.has(parent.localName) ? node.data : escText(node.data);
  }
  if (node instanceof FakeComment) return `<!--${node.data}-->`;
  if (!(node instanceof FakeElement)) return node.childNodes.map(serialize).join('');
  const attrs = [...node.attrs].map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escAttr(value)}"`)).join('');
  const open = `<${node.localName}${attrs}>`;
  return VOID.has(node.localName) && !node.namespaceURI.endsWith('/svg') ? open : `${open}${node.childNodes.map(serialize).join('')}</${node.localName}>`;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATTR = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

/** Markup as nodes: what the page writes with innerHTML and insertAdjacentHTML. */
export const parseHtml = (doc: FakeDocument, html: string): FakeNode[] => {
  const root = new FakeFragment(doc);
  const stack: FakeNode[] = [root];
  const top = (): FakeNode => stack[stack.length - 1] as FakeNode;
  let at = 0;
  while (at < html.length) {
    if (html.startsWith('<!--', at)) {
      const close = html.indexOf('-->', at + 4);
      const stop = close < 0 ? html.length : close;
      top().append(new FakeComment(doc, html.slice(at + 4, stop)));
      at = stop + 3;
    } else if (html.startsWith('<!', at) || html.startsWith('<?', at)) {
      at = html.indexOf('>', at) + 1 || html.length;
    } else if (html.startsWith('</', at) && /[a-z]/i.test(html[at + 2] ?? '')) {
      const close = html.indexOf('>', at);
      const name = html.slice(at + 2, close).trim().toLowerCase();
      const open = stack.findLastIndex((node) => node instanceof FakeElement && node.localName.toLowerCase() === name);
      if (open > 0) stack.length = open;
      at = close + 1;
    } else if (html[at] === '<' && /[a-z]/i.test(html[at + 1] ?? '')) {
      const name = /^[a-zA-Z][\w:-]*/.exec(html.slice(at + 1))![0];
      at += 1 + name.length;
      const lower = name.toLowerCase();
      const parent = top();
      const inSvg = lower === 'svg' || (parent instanceof FakeElement && parent.namespaceURI === SVG_NS);
      const el = new FakeElement(doc, inSvg ? name : lower, inSvg ? SVG_NS : undefined);
      for (;;) {
        ATTR.lastIndex = at;
        if (html[at] === '>' || html.startsWith('/>', at) || at >= html.length) break;
        const found = ATTR.exec(html);
        if (found === null) { at += 1; continue; }
        if (found[1] === '/') { at = ATTR.lastIndex; continue; }
        el.attrs.set(found[1]!.toLowerCase(), decode(found[2] ?? found[3] ?? found[4] ?? ''));
        at = ATTR.lastIndex;
        while (html[at] === ' ' || html[at] === '\n' || html[at] === '\t') at += 1;
      }
      const selfClosed = html.startsWith('/>', at);
      at += selfClosed ? 2 : 1;
      const closes = CLOSES[lower];
      if (closes && parent instanceof FakeElement && closes.has(parent.localName)) stack.pop();
      top().append(el);
      if (RAW.has(lower)) {
        const close = html.toLowerCase().indexOf(`</${lower}`, at);
        const stop = close < 0 ? html.length : close;
        const text = html.slice(at, stop);
        if (text !== '') el.append(lower === 'textarea' || lower === 'title' ? decode(text) : text);
        at = html.indexOf('>', stop) + 1 || html.length;
      } else if (!selfClosed && !(VOID.has(lower) && !inSvg)) stack.push(el);
    } else {
      const next = html.indexOf('<', at + 1);
      const stop = next < 0 ? html.length : next;
      top().append(decode(html.slice(at, stop)));
      at = stop;
    }
  }
  return [...root.childNodes];
};

/* Selectors: compounds of a tag, #id, .class, [attr], [attr="value"] and the
   few pseudo-classes the page asks about, joined by descendant or child
   combinators, in comma lists. */
interface Compound { tag: string | null; id: string | null; classes: string[]; attrs: [string, string | null][]; pseudo: string[]; not: Compound[] }
interface Complex { parts: Compound[]; joins: (' ' | '>')[] }

const unescape = (text: string): string => text.replace(/\\(.)/g, '$1');
const parseCompound = (text: string): Compound => {
  const compound: Compound = { tag: null, id: null, classes: [], attrs: [], pseudo: [], not: [] };
  let at = 0;
  const name = (): string => {
    const found = /^(?:\\.|[\w-])+/.exec(text.slice(at))![0];
    at += found.length;
    return unescape(found);
  };
  if (/[\w*]/.test(text[0] ?? '')) {
    if (text[0] === '*') at = 1; else compound.tag = name().toLowerCase();
  }
  while (at < text.length) {
    const c = text[at];
    if (c === '#') { at += 1; compound.id = name(); }
    else if (c === '.') { at += 1; compound.classes.push(name()); }
    else if (c === '[') {
      const close = text.indexOf(']', at);
      const inner = text.slice(at + 1, close);
      const eq = inner.indexOf('=');
      if (eq < 0) compound.attrs.push([inner.trim().toLowerCase(), null]);
      else {
        const raw = inner.slice(eq + 1).trim();
        const value = /^["']/.test(raw) ? raw.slice(1, -1) : raw;
        compound.attrs.push([inner.slice(0, eq).trim().toLowerCase(), unescape(value)]);
      }
      at = close + 1;
    } else if (c === ':') {
      at += 1;
      const pseudo = name();
      if (text[at] === '(') {
        let depth = 0, stop = at;
        for (; stop < text.length; stop += 1) { if (text[stop] === '(') depth += 1; if (text[stop] === ')' && --depth === 0) break; }
        const inner = text.slice(at + 1, stop);
        if (pseudo === 'not') compound.not.push(parseCompound(inner.trim()));
        else compound.pseudo.push(pseudo);
        at = stop + 1;
      } else compound.pseudo.push(pseudo);
    } else throw new Error(`the test document cannot read the selector ${text}`);
  }
  return compound;
};
const splitTop = (text: string, by: string): string[] => {
  const out: string[] = [];
  let depth = 0, quote = '', from = 0;
  for (let at = 0; at < text.length; at += 1) {
    const c = text[at]!;
    if (quote) { if (c === '\\') at += 1; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '(') depth += 1;
    else if (c === ']' || c === ')') depth -= 1;
    else if (c === by && depth === 0) { out.push(text.slice(from, at)); from = at + 1; }
  }
  out.push(text.slice(from));
  return out;
};
const cache = new Map<string, Complex[]>();
const parseSelectors = (selector: string): Complex[] => {
  const known = cache.get(selector);
  if (known) return known;
  const list = splitTop(selector, ',').map((one) => {
    const spaced = one.trim().replace(/\s*>\s*/g, ' > ');
    const words = splitTop(spaced, ' ').filter(Boolean);
    const complex: Complex = { parts: [], joins: [] };
    let join: ' ' | '>' = ' ';
    for (const word of words) {
      if (word === '>') { join = '>'; continue; }
      if (complex.parts.length > 0) complex.joins.push(join);
      complex.parts.push(parseCompound(word));
      join = ' ';
    }
    return complex;
  });
  cache.set(selector, list);
  return list;
};
const matchCompound = (el: FakeElement, compound: Compound): boolean => {
  if (compound.tag !== null && el.localName.toLowerCase() !== compound.tag) return false;
  if (compound.id !== null && el.getAttribute('id') !== compound.id) return false;
  const classes = el.className.split(/\s+/);
  if (!compound.classes.every((name) => classes.includes(name))) return false;
  if (!compound.attrs.every(([name, value]) => (value === null ? el.hasAttribute(name) : el.getAttribute(name) === value))) return false;
  // Nothing is hovered or focused by a keyboard in a test, and nothing else is asked.
  if (compound.pseudo.length > 0) return false;
  return compound.not.every((inner) => !matchCompound(el, inner));
};
const matchComplex = (el: FakeElement, complex: Complex, scope: FakeNode | null): boolean => {
  const within = (node: FakeNode | null): boolean => node !== null && node !== scope && node instanceof FakeElement;
  const from = (node: FakeElement, index: number): boolean => {
    if (!matchCompound(node, complex.parts[index]!)) return false;
    if (index === 0) return true;
    const join = complex.joins[index - 1];
    let up = node.parentNode as FakeNode | null;
    if (join === '>') return within(up) && from(up as FakeElement, index - 1);
    for (; within(up); up = up!.parentNode as FakeNode | null) if (from(up as FakeElement, index - 1)) return true;
    return false;
  };
  return from(el, complex.parts.length - 1);
};

/** `CSS.escape`, for the selectors the page builds from ids. */
const cssEscape = (value: string): string => String(value).replace(/[^\w-]/g, (c) => '\\' + c);

export interface FakeWindow {
  document: FakeDocument;
  location: { href: string; hash: string; pathname: string; search: string };
  storage: Map<string, string>;
  clipboard: string[];
  [key: string]: any;
}

/**
 * A document holding `markup` in its body, installed as the globals the page
 * reads - `document`, `window`, `location`, `history`, `localStorage`,
 * `navigator`, `CSS` and the observers - and returned with what a test may
 * want to look at: the address, what was stored and what was copied.
 */
/**
 * A media query against a window `width` pixels wide: `(max-width: Npx)` and
 * `(min-width: Npx)`, joined by `and`; anything else (a colour scheme, reduced
 * motion) does not match, as on a plain desktop. Listeners are kept and never
 * called: a test sets the width when it installs the document.
 */
const mediaQuery = (width: number) => (query: string) => {
  const parts = query.split(/\s+and\s+/).map((part) => /\((max|min)-width:\s*(\d+)px\)/.exec(part));
  const matches = parts.every((part) => part !== null && (part[1] === 'max' ? width <= Number(part[2]) : width >= Number(part[2])));
  return { matches, media: query, addEventListener(): void {}, removeEventListener(): void {} };
};

export const installDocument = (markup: string, address = 'file:///project/graph.html', width = 1280): FakeWindow => {
  const doc = new FakeDocument();
  doc.body.append(...parseHtml(doc, markup));
  doc.activeElement = doc.body;
  const [base, hash = ''] = address.split('#');
  const location = {
    href: address,
    hash: hash ? '#' + hash : '',
    pathname: new URL(base!).pathname,
    search: '',
  };
  const storage = new Map<string, string>();
  const clipboard: string[] = [];
  const win = new Target() as unknown as FakeWindow;
  Object.assign(win, {
    document: doc,
    location,
    storage,
    clipboard,
    innerWidth: width,
    innerHeight: 800,
    devicePixelRatio: 1,
    prompt: () => null,
    dispatchEvent: (event: FakeEvent) => { event.target = win; (win as unknown as Target).hear(event); return !event.defaultPrevented; },
  });
  doc.defaultView = win;
  const setHash = (url: string): void => {
    const at = url.indexOf('#');
    location.hash = at < 0 ? '' : url.slice(at);
    location.href = base + location.hash;
  };
  /* The session history as addresses: `replaceState` rewrites the one the
     page is at, `pushState` adds one after it, and `back` steps to the one
     before, saying so the way a browser does - popstate, then hashchange
     when the hash moved. */
  const entries = [location.hash];
  let now = 0;
  const history = {
    get length() { return entries.length; },
    entries,
    replaceState: (_: unknown, __: unknown, url: string) => { setHash(url); entries[now] = location.hash; },
    pushState: (_: unknown, __: unknown, url: string) => {
      setHash(url);
      entries.splice(now + 1, entries.length, location.hash);
      now += 1;
    },
    back: () => {
      if (now === 0) return;
      const was = location.hash;
      now -= 1;
      setHash(entries[now] || '');
      win.dispatchEvent(new FakeEvent('popstate'));
      if (location.hash !== was) win.dispatchEvent(new FakeEvent('hashchange'));
    },
  };
  const globals: Record<string, unknown> = {
    window: win,
    document: doc,
    location,
    history,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
    },
    navigator: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } },
    CSS: { escape: cssEscape },
    HTMLElement: FakeElement,
    MutationObserver: class { observe(): void {} disconnect(): void {} },
    ResizeObserver: class { observe(): void {} disconnect(): void {} },
    requestAnimationFrame: (done: () => void) => setTimeout(done, 0),
    matchMedia: mediaQuery(width),
    getComputedStyle: () => ({ display: '', visibility: '', backgroundColor: '', getPropertyValue: () => '' }),
    XMLSerializer: class { serializeToString(node: FakeNode): string { return serialize(node); } },
  };
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    win[name] = value;
  }
  return win;
};

/** What a person reads in an element: its text with the white space folded. */
export const textOf = (el: { textContent: string } | null): string => (el === null ? '' : el.textContent.replace(/\s+/g, ' ').trim());

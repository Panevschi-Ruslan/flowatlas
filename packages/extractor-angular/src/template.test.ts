import { describe, expect, it } from 'vitest';
import { parseAngularTemplate, type TemplateEvent } from './template.js';

const TEMPLATE = `<div>
  <button (click)="submit()">go</button>
  <form (ngSubmit)="save(form)">
    <input (change)="onChange($event)" (input)="onInput()" (keyup.enter)="submit()" />
  </form>
  <a routerLink="/orders/1">one</a>
  <a [routerLink]="['/orders', id]">two</a>
  <span *ngIf="open" (click)="api.doIt()">structural</span>
  @if (open) { <b (click)="open = !open">block</b> }
  <ng-template #tpl><i (click)="sumbit()">template</i></ng-template>
  @for (order of orders; track order.id) { <p (click)="pick(order)">loop</p> }
  <app-child (done)="onDone()"></app-child>
  <button (click)="$event.stopPropagation()">event</button>
  <button (click)="first(); second()">chain</button>
</div>`;

const events = parseAngularTemplate(TEMPLATE, 'checkout.component.html');
const of = (source: string): TemplateEvent => {
  const found = events.find((event) => event.source === source);
  if (found === undefined) throw new Error(`no event for ${source}`);
  return found;
};

describe('reading the triggers out of a template', () => {
  it('reads a click and the method behind it', () => {
    expect(of('submit()')).toMatchObject({
      name: 'click',
      kind: 'click',
      handlers: [{ kind: 'method', method: 'submit', args: [] }],
    });
  });

  it('treats a form submission as a submission whichever way it is spelled', () => {
    expect(of('save(form)').kind).toBe('submit');
  });

  it('keeps the arguments a handler is given', () => {
    expect(of('onChange($event)').handlers).toEqual([
      { kind: 'method', method: 'onChange', args: ['$event'] },
    ]);
  });

  it('reads a key binding as one event rather than two', () => {
    const keyup = events.filter((event) => event.name === 'keyup.enter');
    expect(keyup).toHaveLength(1);
    expect(keyup[0]?.kind).toBe('keyup');
  });

  it('reads an event a child component of its own declares', () => {
    expect(of('onDone()')).toMatchObject({ name: 'done', kind: 'custom' });
  });

  it('reads a trigger written inside a structural directive exactly once', () => {
    expect(events.filter((event) => event.source === 'api.doIt()')).toHaveLength(1);
  });

  it('reaches a trigger inside a block, a template and a loop', () => {
    expect(of('open = !open').line).toBeGreaterThan(0);
    expect(of('sumbit()').kind).toBe('click');
    expect(of('pick(order)').handlers).toEqual([
      { kind: 'method', method: 'pick', args: ['order'] },
    ]);
  });

  it('tells a call on a property apart from a call on the component', () => {
    expect(of('api.doIt()').handlers).toEqual([
      { kind: 'member', property: 'api', method: 'doIt', args: [] },
    ]);
  });

  it('reads every call of a handler that makes several', () => {
    expect(of('first(); second()').handlers).toEqual([
      { kind: 'method', method: 'first', args: [] },
      { kind: 'method', method: 'second', args: [] },
    ]);
  });

  it('refuses to call an assignment a handler', () => {
    expect(of('open = !open').handlers).toEqual([{ kind: 'other', text: 'open = !open' }]);
  });

  it('reads a call on the event itself as a call on a property, which resolves to nothing', () => {
    expect(of('$event.stopPropagation()').handlers).toEqual([
      { kind: 'member', property: '$event', method: 'stopPropagation', args: [] },
    ]);
  });

  it('reads a link written as text and one built from an array', () => {
    expect(of('/orders/1')).toMatchObject({ kind: 'route', route: '/orders/1' });
    expect(of("['/orders', id]")).toMatchObject({ kind: 'route', route: '/orders/:param' });
  });

  it('numbers lines from one, so an id points where a reader will look', () => {
    expect(of('submit()').line).toBe(2);
    expect(of('submit()').column).toBe(11);
  });

  it('offsets positions into the file a template written inline sits in', () => {
    const inline = parseAngularTemplate('<button (click)="go()"></button>', 'checkout.component.ts', {
      startLine: 12,
      startColumn: 13,
    });
    expect(inline[0]).toMatchObject({ line: 12, column: 21 });
  });

  it('says what a template it could not read got wrong, rather than reporting no triggers', () => {
    const problems: string[] = [];
    const found = parseAngularTemplate('<button (click)="go()"><div></button>', 'broken.html', {
      onError: (message, line) => problems.push(`${line}: ${message}`),
    });
    expect(found).toEqual([]);
    expect(problems[0]).toContain('1: Unexpected closing tag');
  });
});

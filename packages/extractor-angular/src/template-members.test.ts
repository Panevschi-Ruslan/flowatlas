import { describe, expect, it } from 'vitest';
import { readTemplateMembers } from './template-members.js';

/** What a template does with each member of its component (P391). */
const rows = (source: string) => readTemplateMembers(source, 'a.html');

describe('readTemplateMembers', () => {
  it('reads chains past the async pipe, a signal call, loops and aliases', () => {
    const found = rows(
      [
        '@for (order of orders$ | async; track order.id) {',
        '  <li>{{ order.total | currency }} {{ order.lines.length }}</li>',
        '}',
        '<p *ngFor="let row of rows">{{ row.label }}</p>',
        '@if (detail(); as d) { <b>{{ d.customer.name }}</b> }',
        '<span *ngIf="profile$ | async as p">{{ p?.name }}</span>',
        '@let note = detail().note;',
        '<i>{{ note.text }}</i>',
      ].join('\n'),
    );
    expect(found.reads.map((row) => `${row.member}:${row.path.join('.')}:${row.line}`)).toEqual([
      'orders$:id:1',
      'orders$:total:2',
      'orders$:lines:2',
      'rows:label:4',
      'detail:customer.name:5',
      'profile$:name:6',
      'detail:note:7',
      'detail:note.text:8',
    ]);
  });

  it('says a value handed to a method, bound to an element, written to a member, or piped whole', () => {
    const found = rows(
      [
        '<button (click)="open(order)">Open</button>',
        '<app-row [order]="order" [total]="order.total" />',
        '<button (click)="selected = order">Pick</button>',
        '<pre>{{ order | json }}</pre>',
      ].join('\n'),
    );
    expect(found.handed).toEqual([{ member: 'order', path: [], method: 'open', index: 0, line: 1 }]);
    expect(found.bound.map((row) => `${row.element}[${row.property}]=${row.path.join('.')}`)).toEqual(['app-row[order]=', 'app-row[total]=total', 'null[selected]=']);
    expect(found.reads.map((row) => row.path.join('.'))).toEqual(['total']);
    expect(found.unread.map((row) => row.why)).toEqual(['handed to the json pipe']);
  });

  it('marks the longest part of a read the template checks is there first: ?., @if, *ngIf, ??, &&, !, a ternary, == null (P402)', () => {
    const found = rows(
      [
        '<h1>{{ item?.name }}</h1>',
        '@if (item.promo) { <p>{{ item.promo.text }}</p> }',
        '<span>{{ item.badge?.label }}</span>',
        '<p *ngIf="item.note">{{ item.note.body }}</p>',
        '<b>{{ item.tag ?? "" }} {{ item.flag && item.flag.on }} {{ !item.gone }}</b>',
        '<i>{{ item.size ? item.size.cm : 0 }} {{ item.kind == null ? "" : item.kind.name }}</i>',
        '<u>{{ item.plain.text }}</u>',
      ].join('\n'),
    );
    expect(found.reads.map((row) => `${row.path.join('.')}${row.checked === undefined ? '' : `:${row.checked}`}`)).toEqual([
      'name:0',
      'promo:1',
      'promo.text:1',
      'badge.label:1',
      'note:1',
      'note.body:1',
      'tag:1',
      'flag:1',
      'flag.on:1',
      'gone:1',
      'size:1',
      'size.cm:1',
      'kind:1',
      'kind.name:1',
      'plain.text:0',
    ]);
  });

  it('reads a @switch over a field with what it does past its @case blocks (P402)', () => {
    const found = rows(
      [
        "@switch (item.status) { @case ('draft') { <em>d</em> } @case ('live') { <em>l</em> } }",
        "@switch (item.tier) { @case ('gold') { <em>g</em> } @default { <em>-</em> } }",
      ].join('\n'),
    );
    expect(found.reads.map((row) => [row.path.join('.'), row.switched])).toEqual([
      ['status', { has: 'none', cases: ["'draft'", "'live'"], line: 1 }],
      ['tier', { has: 'default', cases: ["'gold'"], line: 2 }],
    ]);
  });
});

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
});

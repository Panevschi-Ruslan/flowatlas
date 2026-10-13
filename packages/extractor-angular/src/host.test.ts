import { GraphBuilder, noAdapters, parseConfig, silentLogger, type RepoGraph } from '@flowatlas/core';
import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractAngular } from './extract-repo.js';
import { hostBindingsOf } from './host.js';

const SOURCE = `
import { Directive, HostBinding, HostListener } from '@angular/core';

class Focusable {
  onFocus(): void {}
}

class Pressable extends Focusable {
  onPress = (): void => undefined;
}

@Directive({ selector: '[appPress]', host: { '(focus)': 'onFocus()', '(keyup)': 'onPress()', '(blur)': 'missing()' } })
export class PressDirective extends Pressable {
  label = 'press';

  @HostListener('click', ['$event'])
  onClick = (event: MouseEvent): void => undefined;

  @HostListener('mousedown')
  handler = function (): void {};

  @HostListener('mouseup')
  notCallable = 42;

  @HostBinding('attr.aria-pressed')
  set pressed(value: boolean) {}
}
`;

describe('what a directive binds on its host, and the members it calls (P45, P50)', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const declaration = project.createSourceFile('/src/press.directive.ts', SOURCE).getClassOrThrow('PressDirective');
  const metadata = declaration
    .getDecoratorOrThrow('Directive')
    .getArguments()[0]
    ?.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const bindings = hostBindingsOf(declaration, metadata);

  it('links listeners to function-valued properties and to methods a base class declares', () => {
    expect(
      bindings.map((binding) => [
        binding.written,
        binding.method === undefined
          ? undefined
          : `${binding.method.getParentOrThrow().getSymbolOrThrow().getName()}.${binding.method.getName()}`,
      ]),
    ).toEqual([
      ['(focus)=onFocus()', 'Focusable.onFocus'],
      ['(keyup)=onPress()', 'Pressable.onPress'],
      ['(blur)=missing()', undefined],
      ['(click)=onClick($event)', 'PressDirective.onClick'],
      ['(mousedown)=handler()', 'PressDirective.handler'],
      ['(mouseup)=notCallable()', undefined],
      ['[attr.aria-pressed]=pressed', undefined],
    ]);
  });
});

const CORE = `
export declare function Directive(metadata: { selector?: string; standalone?: boolean; host?: Record<string, string> }): ClassDecorator;
export declare function HostListener(event: string, args?: string[]): PropertyDecorator & MethodDecorator;
export declare function HostBinding(property?: string): PropertyDecorator;
`;

describe('a directive read whole, with its host listeners on members it inherits (P50)', () => {
  const read = (): RepoGraph => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('node_modules/@angular/core/index.d.ts', CORE);
    project.createSourceFile('node_modules/@angular/core/package.json', '{"name":"@angular/core"}');
    project.createSourceFile('/src/base.ts', [
      'export class Focusable {',
      '  onFocus(): void {}',
      '}',
    ].join('\n'));
    project.createSourceFile('/src/press.directive.ts', SOURCE.replace(
      'class Focusable {\n  onFocus(): void {}\n}\n',
      "import { Focusable } from './base';\n",
    ));
    const builder = new GraphBuilder({ repo: 'web', generatedAt: '2026-01-01T00:00:00.000Z' });
    extractAngular({
      repo: 'web',
      repoDir: '/',
      service: { name: 'web', repo: '.', type: 'angular' },
      config: parseConfig({}),
      pkg: {},
      project,
      checker: project.getTypeChecker(),
      builder,
      adapters: noAdapters,
      logger: silentLogger,
    });
    return builder.build();
  };

  it('names a base class method in another file, and an arrow property, as nodes, and reads a set-only binding', () => {
    const graph = read();
    const directive = graph.nodes.find((node) => node.label === 'PressDirective');
    const members = (directive?.meta?.['hostMembers'] ?? []) as string[];
    const labels = members.map((id) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      return node === undefined ? `missing ${id}` : `${node.file}:${node.label}`;
    });
    expect(labels).toEqual(expect.arrayContaining([
      'src/base.ts:Focusable.onFocus',
      'src/press.directive.ts:Pressable.onPress',
      'src/press.directive.ts:PressDirective.onClick',
    ]));
    expect(directive?.meta?.['hostBindings']).toContain('[attr.aria-pressed]=pressed');
  });
});

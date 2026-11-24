import { describe, expect, it } from 'vitest';
import { classSkeleton, endOfDeclaration } from './source.js';

const endOf = (text: string): number => endOfDeclaration(text.split('\n'), 0);

describe('where a declaration ends', () => {
  it('reads a method whose decorators close braces of their own before it begins', () => {
    const source = [
      "  @Guard({ services: ['worker'] })",
      "  @Post('check')",
      '  public async check(@Body() body: { id: string }) {',
      '    return this.checks.check(body);',
      '  }',
      '',
      "  @Get('next')",
      '  next() {',
      '    return 1;',
      '  }',
    ].join('\n');
    expect(endOf(source)).toBe(4);
  });

  it('reads a class past a decorator written over several lines', () => {
    const source = [
      '@View({',
      "  selector: 'app-board',",
      '  standalone: true,',
      '})',
      'export class BoardView {',
      '  rows = [];',
      '}',
      'export const other = 1;',
    ].join('\n');
    expect(endOf(source)).toBe(6);
  });

  it('reads a decorator with no arguments, and one with arguments on the line it decorates', () => {
    expect(endOf(['@Optional', '@Inject()', 'run() {', '  go();', '}', 'after() {}'].join('\n'))).toBe(4);
    expect(endOf(["@Get('one') one() { return 1; }", 'two() {}'].join('\n'))).toBe(0);
    expect(endOf(["@Get('one') one() {", '  return 1;', '}', 'two() {}'].join('\n'))).toBe(2);
  });

  it('reads a declaration with no decorator as before', () => {
    expect(endOf(['function run() {', '  if (a) {', '    b();', '  }', '}', 'next();'].join('\n'))).toBe(4);
    expect(endOf(['const value = { a: 1 };', 'next();'].join('\n'))).toBe(0);
  });
});

describe('a class skeleton (P382)', () => {
  it('keeps decorators, the declaration and every member first line, each body folded, with its line number', () => {
    const lines = [
      '@Thing({',
      "  name: 'shelf',",
      '})',
      'export class Shelf {',
      '  private readonly items = new Map<string, number>();',
      '',
      '  count(): number {',
      '    return this.items.size;',
      '  }',
      '',
      "  @On('add')",
      '  add(',
      '    name: string,',
      '  ): void {',
      '    if (name) {',
      '      this.items.set(name, 1);',
      '    }',
      '  }',
      '  one(): number { return 1; }',
      '}',
    ];
    expect(classSkeleton(lines, 0, lines.length - 1).split('\n')).toEqual([
      '1  @Thing({ … })',
      '4  export class Shelf {',
      '5    private readonly items = new Map<string, number>();',
      '7    count(): number { … }',
      "11    @On('add')",
      '12    add(',
      '13      name: string,',
      '14    ): void { … }',
      '19    one(): number { return 1; }',
      '20  }',
    ]);
  });
});

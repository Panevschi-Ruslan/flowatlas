import { describe, expect, it } from 'vitest';
import { endOfDeclaration } from './source.js';

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

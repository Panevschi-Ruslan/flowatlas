import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { logLinesIn } from './logs.js';

const linesOf = (source: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('a.ts', source);
  return logLinesIn(file);
};

describe('logLinesIn (P71)', () => {
  it('keeps the template and never a value', () => {
    expect(
      linesOf(
        [
          'this.logger.log(`sent ${order.id} to ${user}`);',
          "console.warn('left ' + days + ' days');",
          "logger.info({ id }, 'archived');",
          'this.logger.error(err);',
          "Logger.debug('static');",
        ].join('\n'),
      ),
    ).toEqual([
      { level: 'log', text: 'sent {id} to {user}', at: 1 },
      { level: 'warn', text: 'left {days} days', at: 2 },
      { level: 'info', text: 'archived', at: 3 },
      { level: 'error', at: 4 },
      { level: 'debug', text: 'static', at: 5 },
    ]);
  });

  it('ignores calls that are not a logger', () => {
    expect(linesOf("this.audit.log('x'); store.error('y'); res.info('z'); logger.send('w');")).toEqual([]);
  });

  it('leaves a class written inside the body to that class', () => {
    expect(linesOf("class A { m() { console.log('inner'); } }")).toEqual([]);
  });
});

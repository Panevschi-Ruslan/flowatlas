import { Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { throwsIn } from './throws.js';

// What a whole route fails with is the snapshot of fixtures/nest-failures.

const bodyOf = (source: string) => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('a.ts', source);
  return file.getFirstDescendantByKindOrThrow(SyntaxKind.FunctionDeclaration).getBodyOrThrow();
};

describe('what a body throws', () => {
  it('reads the status of the framework exceptions and of HttpException with a status', () => {
    const body = bodyOf(`
      import { NotFoundException, HttpException, HttpStatus } from '@nestjs/common';
      function f(a: number) {
        if (a === 1) throw new NotFoundException();
        if (a === 2) throw new HttpException('x', HttpStatus.CONFLICT);
        if (a === 3) throw new HttpException('x', 418);
        if (a === 4) throw new HttpException('x', a);
      }`);
    expect(throwsIn(body).map(({ exception, status }) => [exception, status])).toEqual([
      ['NotFoundException', 404],
      ['HttpException', 409],
      ['HttpException', 418],
      ['HttpException', undefined],
    ]);
  });

  it('follows a class written here to the status it hands its base', () => {
    const body = bodyOf(`
      import { HttpException, ForbiddenException } from '@nestjs/common';
      class Locked extends HttpException { constructor() { super('locked', 423); } }
      class NotYours extends ForbiddenException {}
      function f(a: number) {
        if (a === 1) throw new Locked();
        throw new NotYours();
      }`);
    expect(throwsIn(body).map(({ exception, status }) => [exception, status])).toEqual([
      ['Locked', 423],
      ['NotYours', 403],
    ]);
  });

  it('answers a plain error with 500 and leaves out what it catches and what it rethrows', () => {
    const body = bodyOf(`
      function f(a: number) {
        try { throw new TypeError('caught'); } catch (error) { if (a) throw error; }
        throw new Error('boom');
      }`);
    expect(throwsIn(body)).toEqual([{ exception: 'Error', status: 500, line: 4 }]);
  });

  it('gives no status for an exception of a transport that has none', () => {
    const body = bodyOf(`
      import { RpcException } from '@nestjs/microservices';
      function f() { throw new RpcException('no'); }`);
    expect(throwsIn(body)).toEqual([{ exception: 'RpcException', line: 3 }]);
  });
});

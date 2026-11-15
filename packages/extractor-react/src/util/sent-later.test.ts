import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { sentThrough } from './sent-later.js';

/** The body each `open` of a source is sent with, by the address it opens. */
const sent = (source: string): Record<string, string | null> => {
  const file = new Project({ useInMemoryFileSystem: true }).createSourceFile('upload.ts', source);
  const opens = file.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => call.getExpression().getText().endsWith('.open'));
  return Object.fromEntries(
    opens.map((open: CallExpression) => [open.getArguments()[1]?.getText() ?? '?', sentThrough(open, 'send')?.getArguments()[0]?.getText() ?? null]),
  );
};

describe('where a request opened on a receiver is sent (P296)', () => {
  it('follows a field to the method of the class that sends it', () => {
    expect(
      sent(`
        class Uploader {
          private request = new XMLHttpRequest();
          start(): void { this.request.open('PUT', '/files'); }
          finish(file: Blob): void { this.request.send(file); }
        }
      `),
    ).toEqual({ "'/files'": 'file' });
  });

  it('follows a local value into the field it is kept in', () => {
    expect(
      sent(`
        class Uploader {
          private current?: XMLHttpRequest;
          start(): void {
            const request = new XMLHttpRequest();
            request.open('PUT', '/files');
            this.current = request;
          }
          finish(file: Blob): void { this.current?.send(file); this.current!.send(file); }
        }
      `),
    ).toEqual({ "'/files'": 'file' });
  });

  it('follows a receiver handed in to what each caller sends after handing it (P301)', () => {
    expect(
      sent(`
        function start(request: XMLHttpRequest): void { request.open('PUT', '/files'); }
        function upload(file: Blob): void { const request = new XMLHttpRequest(); start(request); request.send(file); }
        class Notes {
          private request = new XMLHttpRequest();
          constructor(private readonly note: string) {}
          write(): void { begin(this.request); this.request.send(this.note); }
        }
        function begin(request: XMLHttpRequest): void { request.open('POST', '/notes'); }
      `),
    ).toEqual({ "'/files'": 'file', "'/notes'": 'this.note' });
  });

  it('follows a field of an object written in place to its other methods (P301)', () => {
    expect(
      sent(`
        const uploader = {
          request: new XMLHttpRequest(),
          start(): void { this.request.open('PUT', '/files'); },
          finish(file: Blob): void { this.request.send(file); },
        };
      `),
    ).toEqual({ "'/files'": 'file' });
  });

  it('stops at a receiver handed in from where nothing follows it, and at another receiver', () => {
    expect(
      sent(`
        function start(request: XMLHttpRequest): void { request.open('PUT', '/files'); }
        function other(file: Blob): void { const request = new XMLHttpRequest(); request.send(file); }
      `),
    ).toEqual({ "'/files'": null });
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Node, Project, type CallExpression, type Node as TsNode } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import {
  branchView,
  enclosingTests,
  heldFieldsIn,
  objectReader,
  pathOfPattern,
  requestPathOf,
  routePathOf,
  writesHeld,
} from './durable-objects.js';

const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
let count = 0;
const source = (text: string) => project.createSourceFile(`case-${(count += 1)}.ts`, text);

/** The body of the first method or function of a file. */
const bodyOf = (text: string): TsNode => {
  const file = source(text);
  const fn = file.getFunctions()[0] ?? file.getClasses()[0]?.getMethods()[0];
  return fn?.getBody() as TsNode;
};

/** Every statement left in a body once a view leaves parts out, as text. */
const kept = (body: TsNode, leaveOut: ReadonlySet<TsNode>): string[] => {
  const out: string[] = [];
  body.forEachDescendant((node, traversal) => {
    if (leaveOut.has(node)) {
      traversal.skip();
      return;
    }
    if (Node.isReturnStatement(node)) out.push(node.getText());
  });
  return out;
};

describe('the branch of an object\'s fetch a request takes (P361)', () => {
  const fetchBody = () =>
    bodyOf(`
      async function fetch(request: Request) {
        const url = new URL(request.url);
        if (url.pathname === '/publish') {
          return publish();
        }
        if (url.pathname.endsWith('/stream')) return stream();
        switch (url.pathname) {
          case '/close': return close();
          default: return refuse();
        }
      }`);

  it('keeps the branch a path passes and what an untaken one leaves', () => {
    const body = fetchBody();
    const view = branchView(body, '/rooms/:roomId/stream');
    expect(view).toMatchObject({ branched: true, matched: true });
    expect(kept(body, view.leaveOut)).toEqual(['return stream();']);
  });

  it('reads a path equal to a test, and a switch on the path', () => {
    const body = fetchBody();
    expect(kept(body, branchView(body, '/publish').leaveOut)).toEqual(['return publish();']);
    const other = fetchBody();
    expect(kept(other, branchView(other, '/close').leaveOut)).toEqual(['return close();']);
  });

  it('falls through to what no test takes, and leaves everything with no path read', () => {
    const body = fetchBody();
    expect(kept(body, branchView(body, '/elsewhere').leaveOut)).toEqual(['return refuse();']);
    expect(branchView(body, undefined).leaveOut.size).toBe(0);
  });

  it('says nothing of a branch whose test is negated', () => {
    const body = bodyOf(`function fetch(url: URL) { if (url.pathname !== '/stream') return refuse(); return stream(); }`);
    expect(branchView(body, '/stream')).toMatchObject({ branched: false, matched: false });
  });

  it('reads a pattern tested against the path, and one held in a name', () => {
    const body = bodyOf(`
      function fetch(url: URL) {
        if (/^\\/teams\\/([^/]+)\\/feed$/.test(url.pathname)) return team();
        const board = url.pathname.match(/^\\/boards\\/(\\w+)$/);
        if (board) return boardOf();
        return refuse();
      }`);
    expect(kept(body, branchView(body, '/teams/:id/feed').leaveOut)).toEqual(['return team();']);
    const again = bodyOf(`
      function fetch(url: URL) {
        const board = url.pathname.match(/^\\/boards\\/(\\w+)$/);
        if (board) return boardOf();
        return refuse();
      }`);
    expect(kept(again, branchView(again, '/boards/:param').leaveOut)).toEqual(['return boardOf();']);
  });
});

describe('the path a request handed to an object asks for', () => {
  const argumentOf = (text: string): TsNode => {
    const file = source(`declare const c: any; declare const request: Request; declare const id: string;\n${text}`);
    const call = file.getDescendants().filter((node): node is CallExpression => Node.isCallExpression(node)).at(-1) as CallExpression;
    return call.getArguments()[0] as TsNode;
  };

  it('reads an address written out, with what is written into it as a segment', () => {
    expect(requestPathOf(argumentOf(`stub.fetch('https://hub/publish?x=1');`))).toEqual({ kind: 'path', path: '/publish' });
    expect(requestPathOf(argumentOf('stub.fetch(`https://hub/rooms/${id}/leave`);'))).toEqual({ kind: 'path', path: '/rooms/:param/leave' });
    expect(requestPathOf(argumentOf(`stub.fetch(new Request('https://hub/leave', { method: 'POST' }));`))).toEqual({ kind: 'path', path: '/leave' });
  });

  it('takes the request the route was handed, passed on, as asking for the route\'s path', () => {
    expect(requestPathOf(argumentOf('stub.fetch(c.req.raw);'))).toEqual({ kind: 'forwarded' });
    expect(requestPathOf(argumentOf('stub.fetch(new Request(c.req.url, c.req.raw));'))).toEqual({ kind: 'forwarded' });
    expect(requestPathOf(argumentOf('stub.fetch(request);'))).toEqual({ kind: 'forwarded' });
    expect(requestPathOf(argumentOf('stub.fetch(c.whatever);'))).toEqual({ kind: 'unread' });
  });
});

describe('patterns and tests as routes', () => {
  it('reads a plain pattern as a path, and refuses anything else of a pattern', () => {
    expect(pathOfPattern('^\\/teams\\/([^/]+)\\/feed$')).toEqual({ literal: '/teams/:param/feed', op: 'equals' });
    expect(pathOfPattern('^/feeds/(.*)')).toEqual({ literal: '/feeds', op: 'startsWith' });
    expect(pathOfPattern('\\/live$')).toEqual({ literal: '/live', op: 'endsWith' });
    expect(pathOfPattern('^/(a|b)/x$')).toBeUndefined();
  });

  it('declares a route for a path a test equals or a prefix it starts with, and none for a suffix', () => {
    expect(routePathOf([{ literal: '/digest', op: 'equals' }])).toBe('/digest');
    expect(routePathOf([{ literal: '/feeds/', op: 'startsWith' }])).toBe('/feeds/*');
    expect(routePathOf([{ literal: '/watch', op: 'endsWith' }])).toBeUndefined();
  });

  it('collects the tests a call is written under, and none from an else', () => {
    const body = bodyOf(`
      function fetch(url: URL, env: any) {
        if (url.pathname.startsWith('/feeds/')) {
          if (url.pathname.endsWith('/stream')) return env.A.fetch(1);
        } else {
          return env.B.fetch(2);
        }
      }`);
    const calls = body.getDescendants().filter((node): node is CallExpression => Node.isCallExpression(node) && node.getText().includes('.fetch('));
    expect(enclosingTests(calls[0] as CallExpression, body)).toEqual([
      { literal: '/stream', op: 'endsWith' },
      { literal: '/feeds/', op: 'startsWith' },
    ]);
    expect(enclosingTests(calls[1] as CallExpression, body)).toEqual([]);
  });
});

describe('streams an object holds open', () => {
  const file = source(`
    class Hub {
      private writers = new Set<any>();
      private log: string[] = [];
      open(writer: any) { this.writers.add(writer); this.log = [...this.log, 'open']; }
      send(frame: string) { for (const writer of this.writers) writer.write(frame); }
      count() { return this.writers.size; }
    }`);
  const hub = file.getClassOrThrow('Hub');
  const body = (name: string) => hub.getMethodOrThrow(name).getBody() as TsNode;

  it('reads the fields a body adds to', () => {
    expect([...heldFieldsIn(body('open'))].sort()).toEqual(['log', 'writers']);
  });

  it('reads a body that writes a frame to them, and not one that only names them', () => {
    expect(writesHeld(body('send'), new Set(['writers']))).toBe(true);
    expect(writesHeld(body('count'), new Set(['writers']))).toBe(false);
    expect(writesHeld(body('send'), new Set(['log']))).toBe(false);
  });
});

describe('a stub, followed to the class its namespace is made of', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-objects-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, 'wrangler.jsonc'),
    `{ "main": "src/index.ts", "durable_objects": { "bindings": [
      { "name": "ROOMS", "class_name": "Room" },
      { "name": "GONE", "class_name": "Missing" },
      { "name": "AWAY", "class_name": "Remote", "script_name": "other-worker" },
    ] } }`,
  );
  const repo = new Project({ compilerOptions: { strict: false } });
  const index = repo.createSourceFile(
    join(dir, 'src/index.ts'),
    `
    export class Room { async fetch(request: Request) { return new Response(''); } async say(text: string) {} }
    const lookup = new Map<string, any>();
    function roomOf(env: any, id: string) { return env.ROOMS.get(env.ROOMS.idFromName(id)); }
    export function handle(env: any, request: Request) {
      env.ROOMS.get(env.ROOMS.idFromName('a')).fetch(request);
      const stub = env.ROOMS.getByName('b');
      stub.say('hi');
      roomOf(env, 'c').fetch(request);
      env.GONE.get(env.GONE.newUniqueId()).fetch(request);
      env.AWAY.getByName('d').fetch(request);
      env.NOWHERE.getByName('e').fetch(request);
      lookup.get('x').fetch(request);
    }`,
  );
  const functions = new Map(index.getFunctions().map((fn) => [fn.getName(), fn]));
  const reader = objectReader(dir, () => repo.getSourceFiles(), (call) => {
    const callee = call.getExpression();
    return Node.isIdentifier(callee) ? functions.get(callee.getText())?.getBody() : undefined;
  });
  const calls = (functions.get('handle')?.getBody() as TsNode)
    .getDescendants()
    .filter((node): node is CallExpression => Node.isCallExpression(node) && /\.(fetch|say)\(/.test(node.getText()) && !node.getText().includes('\n'));
  const targets = calls.map((call) => {
    const stub = reader.stubCallOf(call);
    return stub === undefined ? undefined : { method: stub.method, kind: stub.target.kind, binding: stub.origin.binding, ...(stub.target.kind === 'class' ? { className: stub.target.className } : {}) };
  });

  it('reads the configuration, and a stub made from an id, by name, held in a name or handed back by a helper', () => {
    expect(reader.config?.objects.map((each) => each.binding)).toEqual(['ROOMS', 'GONE', 'AWAY']);
    expect(targets.slice(0, 3)).toEqual([
      { method: 'fetch', kind: 'class', binding: 'ROOMS', className: 'Room' },
      { method: 'say', kind: 'class', binding: 'ROOMS', className: 'Room' },
      { method: 'fetch', kind: 'class', binding: 'ROOMS', className: 'Room' },
    ]);
  });

  it('says why a class is not followed, and reads no map as a namespace', () => {
    expect(targets.slice(3)).toEqual([
      { method: 'fetch', kind: 'missing', binding: 'GONE' },
      { method: 'fetch', kind: 'elsewhere', binding: 'AWAY' },
      { method: 'fetch', kind: 'undeclared', binding: 'NOWHERE' },
      undefined,
    ]);
  });
});

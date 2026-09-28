import { Node, Project, type CallExpression, type ClassDeclaration, type SourceFile } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { socketio } from './adapters/index.js';
import { shapeChannelNames } from './channel-name.js';
import { endpointShapingAt, isUnreadable } from './endpoint.js';

const SERVER = `
export declare class BroadcastOperator {
  emit(event: string, ...payload: unknown[]): boolean;
  in(room: string): BroadcastOperator;
}
export declare class Socket {
  emit(event: string, ...payload: unknown[]): boolean;
  on(event: string, listener: (...payload: never[]) => void): this;
  readonly broadcast: BroadcastOperator;
}
export declare class Namespace {
  emit(event: string, ...payload: unknown[]): boolean;
  to(room: string): BroadcastOperator;
  in(room: string): BroadcastOperator;
  use(middleware: (socket: Socket, next: () => void) => void): this;
  on(event: string, listener: (socket: Socket) => void): this;
}
export declare class Server extends Namespace {
  constructor(server?: unknown);
  of(namespace: string): Namespace;
}
`;

const CLIENT = `
export declare class Socket {
  emit(event: string, ...payload: unknown[]): this;
  on(event: string, listener: (...payload: never[]) => void): this;
}
declare function lookup(uri?: string): Socket;
export { lookup as io, lookup as connect };
`;

const SOURCE = `
import { Server, type Namespace, type Socket } from 'socket.io';
import { connect, io } from 'socket.io-client';

declare function WebSocketGateway(options?: { namespace?: string }): ClassDecorator;
declare const runtime: { readonly namespace: string };
const base = 'https://api.test';

export class Sockets {
  private live: Namespace;
  private moving: Namespace;
  private readonly kept = new Map<string, Socket>();

  init(server: unknown): void {
    const io = new Server(server);
    this.live = io.of('/live-videos').use((s, next) => next()).on('connection', (socket) => {
      socket.on('subscribe', () => undefined);
      socket.broadcast.emit('joined');
    });
    io.on('connection', (socket) => {
      socket.emit('welcome');
    });
    const dynamic = io.of(runtime.namespace);
    dynamic.emit('hidden');
    this.moving = io.of('/one');
    this.moving = io.of('/two');
  }

  state(id: string): void {
    this.live.in(id).emit('state-change');
  }

  stored(id: string): void {
    this.kept.get(id)?.emit('stored');
  }

  moved(): void {
    this.moving.emit('moved');
  }
}

export class Browser {
  private readonly renamed = connect(base + '/orders');
  private feed = io(\`\${base}/\${runtime.namespace}\`);

  send(): void {
    this.renamed.emit('order:cancel');
    this.feed.emit('order:updated');
  }
}

@WebSocketGateway({ namespace: 'orders' })
export class OrdersGateway {
  private readonly server: Namespace;

  push(region: string): void {
    this.server.to(region).emit('order:updated');
  }
}
`;

let file: SourceFile;

/** The receiver of the publish that names `event`, and the class it sits in. */
const siteOf = (event: string): { receiver: Node; owner: ClassDeclaration } => {
  let found: CallExpression | undefined;
  file.forEachDescendant((node) => {
    if (found !== undefined || !Node.isCallExpression(node)) return;
    const callee = node.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const [first] = node.getArguments();
    if (first !== undefined && Node.isStringLiteral(first) && first.getLiteralValue() === event) {
      found = node;
    }
  });
  if (found === undefined) throw new Error(`no call names ${event}`);
  const callee = found.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) throw new Error('not a method call');
  const owner = found.getFirstAncestor((node) => Node.isClassDeclaration(node));
  if (owner === undefined || !Node.isClassDeclaration(owner)) throw new Error('not in a class');
  return { receiver: callee.getExpression(), owner };
};

/** The channel the call naming `event` lands on, or the text that hid its endpoint. */
const channelOf = (event: string): string => {
  const { receiver, owner } = siteOf(event);
  const shaping = endpointShapingAt(socketio, owner, receiver);
  if (isUnreadable(shaping)) return `unreadable: ${shaping.unreadable}`;
  return shapeChannelNames([event], shaping)[0] ?? '(reserved)';
};

beforeAll(() => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  project.createSourceFile('node_modules/socket.io/index.d.ts', SERVER);
  project.createSourceFile('node_modules/socket.io/package.json', '{"name":"socket.io"}');
  project.createSourceFile('node_modules/socket.io-client/index.d.ts', CLIENT);
  project.createSourceFile('node_modules/socket.io-client/package.json', '{"name":"socket.io-client"}');
  file = project.createSourceFile('sockets.ts', SOURCE);
});

describe('the endpoint a value carries', () => {
  // The whole of R102's third criterion: the server's end of `subscribe` is on
  // the namespace `of` selected, which is where the browser's end already was.
  it('puts a handler on the namespace the connection it was handed belongs to', () => {
    expect(channelOf('subscribe')).toBe('live-videos/subscribe');
  });

  it('follows a namespace kept on a field through an audience', () => {
    expect(channelOf('state-change')).toBe('live-videos/state-change');
  });

  it('keeps the endpoint across a property of the transport', () => {
    expect(channelOf('joined')).toBe('live-videos/joined');
  });

  it('reads the server itself as the root namespace', () => {
    expect(channelOf('welcome')).toBe('welcome');
  });

  it('reads an address written with a plus, through an import renamed at the call site', () => {
    expect(channelOf('order:cancel')).toBe('orders/order:cancel');
  });

  // Stated and unreadable is not the root: the root would join it to ends it
  // never meets.
  it('refuses a namespace it cannot read, at either end', () => {
    expect(channelOf('hidden')).toBe('unreadable: runtime.namespace');
    expect(channelOf('order:updated')).toBe('unreadable: `${base}/${runtime.namespace}`');
  });

  it('refuses a field given two different endpoints', () => {
    expect(channelOf('moved')).toBe('unreadable: this.moving');
  });

  // A map is not the transport, so nothing it returns says anything about an
  // endpoint; the value is left to the class, which here says nothing either.
  it('says nothing about a socket read back out of a collection', () => {
    expect(channelOf('stored')).toBe('stored');
  });
});

describe('the endpoint a class declares', () => {
  // A gateway's server is injected, so the value says nothing and the
  // decorator is where the namespace is; the audience does not change it.
  it('is what a value that says nothing falls back to', () => {
    const gateway = file.getClassOrThrow('OrdersGateway');
    const push = gateway.getMethodOrThrow('push');
    let emit: CallExpression | undefined;
    push.forEachDescendant((node) => {
      if (emit === undefined && Node.isCallExpression(node)) emit = node;
    });
    const callee = emit?.getExpression();
    if (callee === undefined || !Node.isPropertyAccessExpression(callee)) throw new Error('no emit');
    const shaping = endpointShapingAt(socketio, gateway, callee.getExpression());
    expect(isUnreadable(shaping)).toBe(false);
    expect(shapeChannelNames(['order:updated'], isUnreadable(shaping) ? {} : shaping)).toEqual([
      'orders/order:updated',
    ]);
  });
});

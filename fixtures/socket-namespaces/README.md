# socket-namespaces fixture

A plain socket server and a browser in another repository, each naming the same
events on the same namespaces. Two repositories and one configuration, so
`flowatlas build` joins them.

The counterpart to `socket-channels`. There the server is a gateway and states
its namespace on the class, `@WebSocketGateway({ namespace: 'orders' })`. Here
there is no class that states anything: the server is an Express-shaped
application holding `socket.io`, and the namespace is the **value**
`io.of('/live-videos')` returns. Every handler registered on a connection that
namespace hands over, and every publish made through it, is addressed within it.
The shape is PeerTube's, which is where it was found (R102, criterion 3).

Type-checked, never executed:

```
./node_modules/.bin/tsc -p fixtures/socket-namespaces/api/tsconfig.json --noEmit
./node_modules/.bin/tsc -p fixtures/socket-namespaces/web/tsconfig.json --noEmit
```

`api/node_modules` holds a hand-written stub for `socket.io`; `web/node_modules`
holds them for `@angular/core` and `socket.io-client`.

## What it was and what it is

Before, each end decided the namespace its own way. The browser read the address
its socket was opened on, `environment.apiUrl + '/live-videos'`, and named
`live-videos/subscribe`. The server read only a class decorator, found none, and
named a bare `subscribe`. Two channels, one end each, and each looked fine alone:

| Channel before | Publisher | Consumer |
|---|---|---|
| `live-videos/subscribe` | web | — |
| `subscribe` | — | api |
| `live-videos/unsubscribe` | web | — |
| `unsubscribe` | — | api |
| `live-videos/state-change` | — | web |
| `state-change` | api | — |
| `user-notifications/new-notification` | — | web |
| `new-notification` | api | — |
| `ping-server` | web | api |

Now both ends ask one function, `endpointShapingAt` in
`packages/adapters-broker/src/endpoint.ts`, which endpoint the value a call is
made on carries, and compose the name with `shapeChannelNames` as before:

| Channel | Publisher | Consumer |
|---|---|---|
| `live-videos/subscribe` | web `PeerSocketService.watch` | api `PeerSockets.subscribe` |
| `live-videos/unsubscribe` | web `PeerSocketService.unwatch` | api `PeerSockets.unsubscribe` |
| `live-videos/state-change` | api `PeerSockets.sendState` | web `PeerSocketService.apply` |
| `ping-server` | web `PeerSocketService.ping` | api `PeerSockets.pong` |
| `user-notifications/new-notification` | — | web `PeerSocketService.notify` |
| `new-notification` | api `PeerSockets.sendNotification` | — |

## The three ways the server states it — `api/src/live/peer-sockets.ts`

| Site | How the namespace is reached | Channel |
|---|---|---|
| `socket.on('subscribe', …)` | `socket` is the connection handed to `.on('connection', …)` on `io.of('/live-videos').use(…)` | `live-videos/subscribe` |
| `this.liveVideos.in(id).emit('state-change', …)` | `in` keeps the endpoint; the field is assigned that same chain | `live-videos/state-change` |
| `socket.on('ping-server', …)` | a connection on `io` itself, `new Server(…)`: the root | `ping-server` |

`use`, `on` and `in` are the transport's own calls and keep the endpoint of what
they were made on; `of` opens one. That is the whole description, on the
`socketio` adapter as `carriedBy`, and the browser's `io(…)` is the same entry:
the function that opens an endpoint, with the address as its first argument.

## What is not joined, on purpose

`sendNotification` publishes on a socket read back out of a `Map`. Which
namespace that socket was opened on is not something the value says: the map is
not the transport, and following what was put into it would be a guess about
somebody's bookkeeping. So the publish stays on the root, as it was, and
`user-notifications/new-notification` keeps one end. This is PeerTube's
notification socket exactly, and it is the known remainder.

import { Server } from './server';

function boot(server: Server) {
  server.start();
}

function launch(server: Server) {
  boot(server);
}

function main(server: Server) {
  launch(server);
}

main(new Server(4550));
// Kept for a fail-over nothing starts yet.
export const spare = new Server(4551);

import { Server } from './server';

/** Runs the server it is handed. */
class Supervisor {
  constructor(private readonly server: Server) {}

  run() {
    this.server.start();
  }
}

const primary = new Server(4440);
// Kept for a fail-over nothing starts yet.
export const spare = new Server(4441);

new Supervisor(primary).run();

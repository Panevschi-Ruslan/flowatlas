import { Listener } from './listener';

const panel = new Listener({ port: 4341 });
// Made for a later release, and never started.
export const metrics = new Listener({ port: 4342 });

panel.start();

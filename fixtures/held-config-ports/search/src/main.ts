import { start, startAdmin } from './server';

start(4200);
startAdmin({ port: 4201 });
startAdmin();

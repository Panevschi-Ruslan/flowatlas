import { provideRouter } from '@angular/router';

import routes from './app/app.routes';

// The root of the configuration, reached through a default import. This is where
// the prefix that every lazy file is mounted under starts.
provideRouter(routes);

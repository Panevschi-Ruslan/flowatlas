import { provideRouter } from '@angular/router';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

/** The root of the configuration, and the component the page's markup holds. */
provideRouter(routes);
export const bootstrapped = [AppComponent];

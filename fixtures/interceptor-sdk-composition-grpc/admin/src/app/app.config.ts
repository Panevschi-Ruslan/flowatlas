import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { prefixInterceptor } from './prefix.interceptor';

export const appConfig = {
  providers: [provideHttpClient(withInterceptors([prefixInterceptor]))],
};

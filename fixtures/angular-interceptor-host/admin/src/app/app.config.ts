import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { baseInterceptor } from './interceptors/base.interceptor';

export const appConfig = {
  providers: [provideHttpClient(withInterceptors([baseInterceptor]))],
};

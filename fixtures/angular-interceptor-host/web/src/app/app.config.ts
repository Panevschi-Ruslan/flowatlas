import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { apiInterceptor } from './interceptors/api.interceptor';
import { authInterceptor } from './interceptors/auth.interceptor';

export const appConfig = {
  providers: [provideHttpClient(withInterceptors([apiInterceptor, authInterceptor]))],
};

import axios from 'axios';

const transport = axios.create({ baseURL: '/store-rest' });

// Spreadsheets are served by the exports API, whatever the screen asked for.
transport.interceptors.request.use((config) => {
  if (config.url.endsWith('.csv')) config.baseURL = '/exports';
  return config;
});

/** The front end's own client class, writing every request through the instance above. */
export class ApiClient {
  get<T>(path: string): Promise<T> {
    return transport.get<T>(path).then((res) => res.data);
  }
}

export const apiClient = new ApiClient();

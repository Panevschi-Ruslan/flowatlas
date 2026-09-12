/** Injection token shared by ConfigModule and its consumers. */
export const CONFIG = 'CONFIG';

export interface AppConfig {
  baseUrl: string;
  retries: number;
}

export interface Cache {
  get(key: string): string;
}

export interface Client {
  send(message: string): string;
}

import { Injectable } from '@nestjs/common';

/** Where the store API is served; a deployment may move it. */
export interface ApiOptions {
  /**
   * @description
   * The path of the GraphQL API the shop calls.
   *
   * @default 'store-api'
   */
  storePath?: string;
}

export interface AppConfig {
  apiOptions: ApiOptions;
}

@Injectable()
export class ConfigService {
  private active: AppConfig = { apiOptions: {} };

  get apiOptions(): Required<ApiOptions> {
    return this.active.apiOptions as Required<ApiOptions>;
  }

  load(config: AppConfig): void {
    this.active = config;
  }
}

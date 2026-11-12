import { Injectable } from '@nestjs/common';

/** Where the two APIs are served; a deployment may move either. */
export interface ApiSettings {
  /**
   * @description
   * The path of the API the shop front calls.
   *
   * @default 'store-api'
   */
  storePath?: string;
  /**
   * @description
   * The path of the API the staff kiosk calls.
   *
   * @default 'office-api'
   */
  officePath?: string;
}

@Injectable()
export class SettingsService {
  private active: Required<ApiSettings> = { storePath: 'store-api', officePath: 'office-api' };

  get api(): Required<ApiSettings> {
    return this.active;
  }

  load(settings: ApiSettings): void {
    this.active = { ...this.active, ...settings };
  }
}

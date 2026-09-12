import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import type { CategoryDto, DeepDto } from './deep.dto';
import type { WireBrokenDto, WireDto } from './wire.dto';

/** The calls that exercise the rules of the wire, and the depth of the walk. */
@Injectable()
export class WireClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Every rule at once. Nothing here may be an error. */
  send(body: WireDto): { data: unknown } {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/wire`, body);
  }

  /** The control: two breaks the rules must not hide. */
  sendBroken(body: WireBrokenDto): { data: unknown } {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/wire/broken`, body);
  }

  /** Five levels, differing at the fifth. */
  sendDeep(body: DeepDto): { data: unknown } {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/deep`, body);
  }

  /** A shape that contains itself: the walk has to stop and the report has to not. */
  sendCategory(body: CategoryDto): { data: unknown } {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/deep/categories`, body);
  }
}

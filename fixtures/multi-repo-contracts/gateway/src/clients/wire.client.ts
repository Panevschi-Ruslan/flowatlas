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
  send(body: WireDto) {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/wire`, body);
  }

  /** The control: two breaks the rules must not hide. */
  sendBroken(body: WireBrokenDto) {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/wire/broken`, body);
  }

  /** Five levels, differing at the fifth. */
  sendDeep(body: DeepDto) {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/deep`, body);
  }

  /** A shape that contains itself: the walk has to stop and the report has to not. */
  sendCategory(body: CategoryDto) {
    return this.http.post<void>(`${this.config.get('ORDERS_URL')}/deep/categories`, body);
  }
}

// The request methods above declare no return type on purpose. What a request
// answers with is the library's business — `HttpService.get<T>` gives back
// `Observable<AxiosResponse<T>>` — and letting that signature decide is what
// makes this fixture a test of the library's shape rather than of a shape
// somebody retyped. They used to say `{ data: unknown }`, which no real Nest
// client can say and which hid the delivery wrapper the graph reads through.
//
// Do not put an annotation back. It would need two imports, and every line
// below them would move; node ids carry line numbers, and the fixture section
// of the repository README lists what that breaks.

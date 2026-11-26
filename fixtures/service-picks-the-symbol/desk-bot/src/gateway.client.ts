import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The bot's client: `book` requests the gateway's `GET /books/:bookId` through `LENDING_GATEWAY_URL`. */
@Injectable()
export class GatewayClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async book(bookId: string): Promise<string> {
    const response = await firstValueFrom(this.http.get<string>(`${this.config.get('LENDING_GATEWAY_URL')}/books/${bookId}`));
    return response.data;
  }
}

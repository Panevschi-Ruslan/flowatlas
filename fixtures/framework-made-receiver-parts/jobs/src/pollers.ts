import axios from 'axios';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

const catalogApi = axios.create({ baseURL: 'http://localhost:4600' });
const stockApi = axios.create({ baseURL: 'http://localhost:4700' });

/** Made by the injector from the module's listing, its client injected by token. */
@Injectable()
export class Poller {
  constructor(@Inject('CATALOG_API') private api) {}

  @Interval(60000)
  poll() {
    return this.api.get('/health');
  }
}

/** Another instance, only made: not the one the framework calls. */
export function probe() {
  return new Poller(stockApi);
}

/** A reader the module provides by another class's name. */
export class Reader {
  constructor(private api) {}

  read(path: string) {
    return this.api.get(path);
  }
}

/** What the module makes for `Reader`, handing its token's client on to `super`. */
@Injectable()
export class StockReader extends Reader {
  constructor(@Inject('STOCK_API') api) {
    super(api);
  }
}

/** Injected the provided `Reader`, called by the framework once the module is up. */
@Injectable()
export class Levels {
  constructor(private reader: Reader) {}

  onModuleInit() {
    return this.reader.read('/levels');
  }
}

/** A reader the code makes itself, on the other client. */
export function catalogHealth() {
  return new Reader(catalogApi).read('/health');
}

@Module({
  providers: [
    Poller,
    Levels,
    { provide: 'CATALOG_API', useValue: catalogApi },
    { provide: 'STOCK_API', useFactory: () => stockApi },
    { provide: Reader, useClass: StockReader },
  ],
})
export class PollersModule {}

import { Inject, Injectable, Module } from '@nestjs/common';
import { catalogApi, Reader, stockApi } from './shared';

/** Injected by a token the list a static method returns provides; typed as nothing. */
@Injectable()
export class Levels {
  constructor(@Inject('LEVELS_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/levels');
  }
}

/** Injected by a token the list an object's function returns provides. */
@Injectable()
export class Summary {
  constructor(@Inject('SUMMARY_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/summary');
  }
}

/** Injected by a token the list an object's method returns provides. */
@Injectable()
export class Mirror {
  constructor(@Inject('MIRROR_READER') private reader) {}

  onModuleInit() {
    return this.reader.read('/mirror');
  }
}

/** Providers a static method builds. */
export class Providers {
  static all() {
    return [Levels, { provide: 'LEVELS_READER', useValue: new Reader(stockApi) }];
  }
}

/** Providers an object's members build: a function it holds, and a method. */
const registry = {
  summary: () => [Summary, { provide: 'SUMMARY_READER', useValue: new Reader(catalogApi) }],
  mirror() {
    return [Mirror, { provide: 'MIRROR_READER', useValue: new Reader(stockApi) }];
  },
};

@Module({
  providers: [...Providers.all(), ...registry.summary(), ...registry.mirror()],
})
export class ReadersModule {}

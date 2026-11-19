import { Module } from '@nestjs/common';

/** Orders kept in memory, for a shop run on one machine. */
@Module({})
export class MemoryStorageModule {}

/** Orders kept in a database, configured with its address. */
@Module({})
export class DatabaseModule {
  static forRoot(url: string) {
    return { module: DatabaseModule, providers: [{ provide: 'DATABASE_URL', useValue: url }] };
  }
}

/** The database the shop is deployed with. */
export const database = () => DatabaseModule.forRoot('postgres://orders.internal/shop');

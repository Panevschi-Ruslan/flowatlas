import { Module } from '@nestjs/common';
import { createTRPCClient, httpBatchLink, type TRPCClient } from '@trpc/client';
import type { AppRouter } from '@shop/router';

/** The tokens the clients are provided for. */
export const ORDERS_CLIENT = 'ORDERS_CLIENT';
export const LEDGER_CLIENT = 'LEDGER_CLIENT';
const ORDERS_OPTIONS = 'ORDERS_OPTIONS';
const LEDGER_OPTIONS = 'LEDGER_OPTIONS';

export interface ClientOptions {
  url: string;
}

export interface AsyncClientOptions {
  useFactory: (...args: any[]) => ClientOptions;
  inject?: any[];
}

/** The orders client, typed from the shared tree. */
export type OrdersClient = TRPCClient<AppRouter>;

/**
 * The orders client, configured by the application that imports it: with the
 * address written in place, or with a factory that works it out. Both build
 * the client in a provider of their own; the application calls one.
 */
@Module({})
export class OrdersClientModule {
  static forRoot(options: ClientOptions) {
    return {
      module: OrdersClientModule,
      providers: [{ provide: ORDERS_CLIENT, useFactory: () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: options.url })] }) }],
      exports: [ORDERS_CLIENT],
    };
  }

  static forRootAsync(options: AsyncClientOptions) {
    return {
      module: OrdersClientModule,
      providers: [
        { provide: ORDERS_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        {
          provide: ORDERS_CLIENT,
          useFactory: (resolved: ClientOptions) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: resolved.url })] }),
          inject: [ORDERS_OPTIONS],
        },
      ],
      exports: [ORDERS_CLIENT],
    };
  }
}

/** The ledger client, untyped: the ledger's tree is not shared. */
@Module({})
export class LedgerClientModule {
  static forRoot({ url }: ClientOptions) {
    return {
      module: LedgerClientModule,
      providers: [{ provide: LEDGER_CLIENT, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url })] }) }],
      exports: [LEDGER_CLIENT],
    };
  }

  static forRootAsync(options: AsyncClientOptions) {
    return {
      module: LedgerClientModule,
      providers: [
        { provide: LEDGER_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] },
        { provide: LEDGER_CLIENT, useFactory: ({ url }: ClientOptions) => createTRPCClient<any>({ links: [httpBatchLink({ url })] }), inject: [LEDGER_OPTIONS] },
      ],
      exports: [LEDGER_CLIENT],
    };
  }
}

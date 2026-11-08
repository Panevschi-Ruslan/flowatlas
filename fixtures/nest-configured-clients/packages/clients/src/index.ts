import { Module } from '@nestjs/common';
import { createTRPCClient, httpBatchLink } from '@trpc/client';

/** The tokens the clients are provided for. */
export const ORDERS_CLIENT = 'ORDERS_CLIENT';
export const LEDGER_CLIENT = 'LEDGER_CLIENT';
export const AUDIT_CLIENT = 'AUDIT_CLIENT';
const ORDERS_OPTIONS = 'ORDERS_OPTIONS';

export interface ClientOptions {
  /** Where the service answers: its procedures are under a path of their own. */
  base: string;
}

export interface AsyncClientOptions {
  useFactory: (...args: any[]) => ClientOptions;
  inject?: any[];
}

/**
 * The orders client, configured by the application that imports it. Each
 * method builds the client's link over the base address it is handed, so the
 * address is a template over a parameter: `${options.base}/trpc`.
 */
@Module({})
export class OrdersClientModule {
  static forRoot(options: ClientOptions) {
    return {
      module: OrdersClientModule,
      providers: [{ provide: ORDERS_CLIENT, useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: `${options.base}/trpc` })] }) }],
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
          useFactory: (resolved: ClientOptions) => createTRPCClient<any>({ links: [httpBatchLink({ url: `${resolved.base}/trpc` })] }),
          inject: [ORDERS_OPTIONS],
        },
      ],
      exports: [ORDERS_CLIENT],
    };
  }
}

/** The ledger client, by a plain function the application calls once: its address joined with `+`. */
export const ledgerClient = (base: string) => createTRPCClient<any>({ links: [httpBatchLink({ url: base + '/rpc' })] });

/**
 * The audit module provides a token by a configuring method the application
 * calls; nothing here builds a client from it, and the injection is still
 * provided.
 */
@Module({})
export class AuditModule {
  static register(label: string) {
    return {
      module: AuditModule,
      providers: [{ provide: AUDIT_CLIENT, useValue: { label } }],
      exports: [AUDIT_CLIENT],
    };
  }
}

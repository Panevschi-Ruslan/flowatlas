import { Module } from '@nestjs/common';
import { createTRPCClient, createTRPCUntypedClient, httpBatchLink } from '@trpc/client';
import { BillingService } from './billing.service';

/** The tokens the billing clients are provided for and injected by. */
export const BILLING_CLIENT = 'BILLING_CLIENT';
export const BILLING_UNTYPED = 'BILLING_UNTYPED';

/** Builds the untyped client: a factory of the module's own, named rather than written in place. */
const untypedBilling = () => createTRPCUntypedClient({ links: [httpBatchLink({ url: `${process.env.BILLING_URL}/trpc` })] });

/**
 * The billing clients are built in factories and provided for tokens, the
 * commonest way a NestJS service is handed a client: the service that uses
 * one names the token, not the factory.
 */
@Module({
  providers: [
    {
      provide: BILLING_CLIENT,
      useFactory: () => createTRPCClient<any>({ links: [httpBatchLink({ url: `${process.env.BILLING_URL}/trpc` })] }),
    },
    { provide: BILLING_UNTYPED, useFactory: untypedBilling },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}

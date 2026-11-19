import { createTRPCClient, createTRPCUntypedClient, httpLink } from '@trpc/client';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';

/**
 * An untyped client whose path is text. PAYMENTS_URL is claimed by no service;
 * the worker's own example environment gives it a billing.internal address,
 * which is taken as billing, as a guess.
 */
const payments = createTRPCUntypedClient({ links: [httpLink({ url: `${process.env.PAYMENTS_URL}/trpc` })] });

export const refundInvoice = (invoiceId: string) => payments.mutation('invoices.refund', { invoiceId });

/** A setting nothing claims and nothing gives a value: where it goes is not known. */
const legacy = createORPCClient<any>(new RPCLink({ url: `${process.env.LEGACY_URL}/rpc` }));

export const legacyOrders = () => legacy.orders.list({});

/** A link that works its address out for every request. */
const discovered = createORPCClient<any>(new RPCLink({ url: () => `${process.env.DISCOVERY_HOST}/rpc` }));

export const discoveredOrder = (id: string) => discovered.orders.get({ id });

/** A third party's tRPC API: an external API, not a service of this project. */
const ledger = createTRPCClient<any>({ links: [httpLink({ url: 'https://ledger.partner.example/trpc' })] });

export const recordEntry = (amount: number) => ledger.entries.record.mutate({ amount });

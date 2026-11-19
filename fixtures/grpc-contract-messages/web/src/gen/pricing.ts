// Code generated from store.proto. DO NOT EDIT.
import { makeGenericClientConstructor, type ChannelCredentials, type Client, type ServiceError } from '@grpc/grpc-js';

export interface QuoteLine {
  sku: string;
  quantity: number;
}

export interface QuoteRequest {
  lines: QuoteLine[];
  currencyCode: string;
  couponCode?: string;
  loyaltyPoints?: number;
}

export interface Money {
  currencyCode: string;
  units: number;
  nanos: number;
}

export interface PriceQuote {
  total?: Money;
}

export const PricingServiceService = {
  quote: { path: '/store.PricingService/Quote' as const, requestStream: false, responseStream: false },
} as const;

export interface PricingServiceClient extends Client {
  quote(request: QuoteRequest, callback: (error: ServiceError | null, reply: PriceQuote) => void): void;
}

export const PricingServiceClient = makeGenericClientConstructor(PricingServiceService, 'store.PricingService') as unknown as {
  new (address: string, credentials: ChannelCredentials): PricingServiceClient;
};

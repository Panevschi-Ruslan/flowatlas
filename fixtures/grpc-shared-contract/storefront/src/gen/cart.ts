// Code generated from shop.proto. DO NOT EDIT.
import { makeGenericClientConstructor, type ChannelCredentials, type Client, type ServiceError } from '@grpc/grpc-js';

export interface Cart {
  userId: string;
  productIds: string[];
}

export const CartServiceService = {
  addItem: { path: '/shop.CartService/AddItem' as const, requestStream: false, responseStream: false },
  getCart: { path: '/shop.CartService/GetCart' as const, requestStream: false, responseStream: false },
  emptyCart: { path: '/shop.CartService/EmptyCart' as const, requestStream: false, responseStream: false },
} as const;

export interface CartServiceClient extends Client {
  addItem(request: { userId: string; productId: string; quantity: number }, callback: (error: ServiceError | null, reply: object) => void): void;
  getCart(request: { userId: string }, callback: (error: ServiceError | null, reply: Cart) => void): void;
  emptyCart(request: { userId: string }, callback: (error: ServiceError | null, reply: object) => void): void;
}

export const CartServiceClient = makeGenericClientConstructor(CartServiceService, 'shop.CartService') as unknown as {
  new (address: string, credentials: ChannelCredentials): CartServiceClient;
};

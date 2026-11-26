export const PUBLIC_API_URL = 'https://demo.shop.example/store-api';

export let API_URL = typeof process !== 'undefined' ? process.env.STORE_API_URL ?? PUBLIC_API_URL : PUBLIC_API_URL;

/** Where the platform hands settings to the request rather than the process. */
export function pointApiAt(address: string): void {
  API_URL = address;
}

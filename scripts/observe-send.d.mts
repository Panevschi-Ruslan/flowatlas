/** One post the sender makes. */
export interface SendRequest {
  path: string;
  label: string;
  headers: Record<string, string>;
  body: Buffer;
}

export interface SendAnswer {
  label: string;
  path: string;
  status: number;
  body: Buffer;
}

export declare const DEFAULT_URL: string;
export declare const DEFAULT_FILES: string[];
export declare const ENCODINGS: string[];
export declare const SENDER_SECRET: string;
export declare const requestsFor: (files: readonly string[], options?: { start?: number }) => SendRequest[];
export declare const extraRequests: () => SendRequest[];
export declare const post: (url: string, request: Pick<SendRequest, 'path' | 'headers' | 'body'>) => Promise<{ status: number; body: Buffer }>;
export declare const sendAll: (url: string, requests: readonly SendRequest[]) => Promise<SendAnswer[]>;

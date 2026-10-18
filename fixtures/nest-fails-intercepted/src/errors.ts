/** Every error of the shop's own: each says the status it means. */
export abstract class ShopError extends Error {
  abstract readonly status: number;
}

export class BookNotFound extends ShopError {
  readonly status = 404;

  constructor(id: string) {
    super(`book ${id} not found`);
  }
}

export class StockExhausted extends ShopError {
  readonly status = 409;
}

export class ReportUnavailable extends ShopError {
  readonly status = 503;
}

/** Says no status at all. */
export class PlainFailure extends Error {}

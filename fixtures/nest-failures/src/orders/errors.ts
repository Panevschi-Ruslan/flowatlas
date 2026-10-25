import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';

/** Its own class, with the status handed to the framework's base. */
export class OutOfStockError extends HttpException {
  constructor(sku: string) {
    super(`${sku} is out of stock`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/** A built-in exception under another name, with no constructor of its own. */
export class CouponRejectedError extends BadRequestException {}

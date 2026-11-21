import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * The method every way in below ends at: what could break if it changes. Its
 * failure is on every route that reaches it, thrown here: a compact answer
 * at detail 2 leaves out the `at` that is this method and the `file` it holds.
 */
@Injectable()
export class OrdersService {
  private readonly statuses = new Map<string, string>();

  async updateStatus(orderId: string, status: string): Promise<void> {
    if (status === '') throw new BadRequestException('a status is required');
    this.statuses.set(orderId, status);
  }
}

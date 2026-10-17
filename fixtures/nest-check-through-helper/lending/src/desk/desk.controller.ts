import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Post, Query } from '@nestjs/common';

import { toHttpError, toNotFound } from '../auth/http-errors';
import { LibrarianAuth } from '../auth/librarian-auth';
import { Loan } from './loan.entity';
import { LoansService } from './loans.service';

/**
 * The lending desk. No guard: each handler asks `LibrarianAuth` itself and
 * turns a refusal into an exception through a helper.
 */
@Controller('desk')
export class DeskController {
  constructor(
    private readonly librarianAuth: LibrarianAuth,
    private readonly loans: LoansService,
  ) {}

  /** `throw toHttpError(check)`: 401, 403 or 423, chosen from the table. */
  @Post('renewals')
  async renew(@Headers('x-badge') badge: string, @Body() loan: Loan): Promise<Loan> {
    const check = await this.librarianAuth.verify(badge);
    if (!check.ok) throw toHttpError(check);
    return this.loans.renew(loan);
  }

  /** The same helper, its answer held in a `const` first. */
  @Delete('holds/:id')
  async cancelHold(@Headers('x-badge') badge: string, @Param('id') id: string): Promise<unknown> {
    const check = await this.librarianAuth.verify(badge);
    if (!check.ok) {
      const error = toHttpError(check);
      throw error;
    }
    return this.loans.cancelHold(id);
  }

  /** A helper whose answer is whatever it is handed: the check above it is what says who is asking. */
  @Get('overdue')
  async overdue(@Headers('x-badge') badge: string): Promise<Loan[]> {
    if (!(await this.librarianAuth.verify(badge)).ok) throw this.reject(new ForbiddenException('staff only'));
    return this.loans.overdue();
  }

  /** A helper with a table too, of not-found answers: no check of who is asking. */
  @Get('stats')
  async stats(@Query('period') period: string): Promise<number> {
    if (period === 'withdrawn' || period === 'unknown') throw toNotFound(period);
    return this.loans.count();
  }

  private reject(error: Error): Error {
    console.warn(`desk refused: ${error.message}`);
    return error;
  }
}

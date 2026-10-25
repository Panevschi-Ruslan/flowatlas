import { Injectable } from '@nestjs/common';

import { LoanNotFound, LoanOverdue, PlainFailure, ShelfLocked } from '../errors';
import { CreateLoanDto } from './create-loan.dto';
import { assertBookId } from './checks';
import { SearchQuery } from './search-query';

interface Loan {
  id: string;
  bookId: string;
  memberId: string;
  overdue: boolean;
}

@Injectable()
export class LoansService {
  private readonly loans = new Map<string, Loan>();

  list(): Loan[] {
    return [...this.loans.values()];
  }

  search(query: SearchQuery): Loan[] {
    return this.list().filter((loan) => query.title === undefined || loan.bookId.includes(query.title));
  }

  findOne(id: string): Loan {
    const loan = this.loans.get(id);
    if (loan === undefined) throw new LoanNotFound(id);
    return loan;
  }

  create(dto: CreateLoanDto): Loan {
    assertBookId(dto.bookId);
    for (const loan of this.loans.values()) {
      if (loan.memberId === dto.memberId && loan.overdue) throw new LoanOverdue(loan.id);
      if (loan.bookId === dto.bookId && loan.overdue) throw new LoanOverdue(loan.id);
    }
    if (this.loans.size > 1000) throw new PlainFailure('the loan book is full');
    const loan = { id: String(this.loans.size + 1), ...dto, overdue: false };
    this.loans.set(loan.id, loan);
    return loan;
  }

  shelf(id: string): string {
    if (this.findOne(id).overdue) throw new ShelfLocked('shelf locked');
    return 'open';
  }
}

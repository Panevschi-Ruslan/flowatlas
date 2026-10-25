import { Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';

import { Hold } from './hold.entity';
import { Loan } from './loan.entity';

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loans: Repository<Loan>,
    @InjectRepository(Hold)
    private readonly holds: Repository<Hold>,
  ) {}

  renew(loan: Loan): Promise<Loan> {
    return this.loans.save(loan);
  }

  cancelHold(id: string): Promise<unknown> {
    return this.holds.delete({ id });
  }

  overdue(): Promise<Loan[]> {
    return this.loans.find({ where: { overdue: true } });
  }

  count(): Promise<number> {
    return this.loans.count();
  }
}

import { Injectable } from '@nestjs/common';

import { LoanOverdue, PlainFailure } from '../errors';

@Injectable()
export class ReportsService {
  overdue(): string[] {
    const ids = ['l-1'];
    if (ids.length > 100) throw new PlainFailure('too many to report');
    if (ids.includes('l-0')) throw new LoanOverdue('l-0');
    return ids;
  }
}

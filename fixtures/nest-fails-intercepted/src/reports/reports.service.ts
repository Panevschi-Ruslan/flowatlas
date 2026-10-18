import { Injectable } from '@nestjs/common';

import { PlainFailure } from '../errors';

@Injectable()
export class ReportsService {
  sales(): number[] {
    const totals = [12, 30];
    if (totals.length > 365) throw new PlainFailure('too long a period');
    return totals;
  }
}

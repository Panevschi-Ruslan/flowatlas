import { Injectable } from '@nestjs/common';
import { ReportBuilder } from './report.builder';

@Injectable()
export class ReportsService {
  constructor(private readonly builder: ReportBuilder) {}

  daily(): string[] {
    return this.builder.build(['basket', 'crate']);
  }
}

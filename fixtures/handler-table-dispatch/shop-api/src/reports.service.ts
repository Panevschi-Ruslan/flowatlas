import { Injectable } from '@nestjs/common';

import { loadPluginReports } from './plugins';
import { stockReport } from './stock-report';

export interface ReportBuilder {
  kind: string;
  build: () => Promise<string>;
}

/**
 * Reports by kind, a table of strategies selected by `===`. Two are written
 * out; the plugins' are spread in from a registry filled at run time, so the
 * call keeps its gap, with the count.
 */
@Injectable()
export class ReportsService {
  private static readonly BUILDERS: readonly ReportBuilder[] = [
    { kind: 'daily', build: () => ReportsService.daily() },
    { kind: 'stock', build: stockReport },
    ...loadPluginReports(),
  ];

  async build(kind: string): Promise<string> {
    const builder = ReportsService.BUILDERS.find((each) => each.kind === kind);
    return builder ? builder.build() : 'unknown report';
  }

  private static async daily(): Promise<string> {
    return 'daily';
  }
}

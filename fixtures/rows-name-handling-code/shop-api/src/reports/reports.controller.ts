import { Controller, Delete, Get, Param, Post } from '@nestjs/common';

interface ReportRow {
  day: string;
  total: number;
}

/**
 * Four routes, two of which the reports screen requests: `daily` and
 * `export`. Nothing in either repository requests `weekly` or the delete.
 */
@Controller('api/reports')
export class ReportsController {
  private readonly rows: ReportRow[] = [];

  @Get('daily')
  daily(): ReportRow[] {
    return this.rows.slice(-1);
  }

  @Get('weekly')
  weekly(): ReportRow[] {
    return this.rows.slice(-7);
  }

  @Post('export')
  export(): { rows: number } {
    return { rows: this.rows.length };
  }

  @Delete(':id')
  remove(@Param('id') id: string): void {
    const at = this.rows.findIndex((row) => row.day === id);
    if (at >= 0) this.rows.splice(at, 1);
  }
}

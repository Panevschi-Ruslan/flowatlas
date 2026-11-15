import type { ComponentType } from 'react';

/** One report: its key, its address and its screen. */
export interface Report {
  readonly id: string;
  readonly path: string;
  readonly Screen: ComponentType;
}

const reports: Record<string, Report> = {};

/** Files a report under its key. */
export function addReport(report: Report): void {
  reports[report.id] = report;
}

/** Every report filed. */
export function allReports(): Report[] {
  return Object.values(reports);
}

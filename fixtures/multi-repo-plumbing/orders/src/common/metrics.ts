import { Injectable } from '@nestjs/common';

import { AppLogger } from './app-logger';

/** A counter every method bumps, which logs what it counted: more plumbing. */
@Injectable()
export class Metrics {
  private readonly counts = new Map<string, number>();

  constructor(private readonly logger: AppLogger) {}

  count(name: string): void {
    this.record(name, 1);
  }

  private record(name: string, value: number): void {
    const key = this.keyOf(name);
    this.counts.set(key, (this.counts.get(key) ?? 0) + value);
    this.logger.log(`${key}=${value}`, 'Metrics');
  }

  private keyOf(name: string): string {
    return name.toLowerCase();
  }
}

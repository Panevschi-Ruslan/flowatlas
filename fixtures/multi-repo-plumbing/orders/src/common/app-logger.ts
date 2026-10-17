import { Injectable } from '@nestjs/common';

/**
 * The logger every method of this service writes through: the plumbing a walk
 * meets under every caller. Called from more than five methods, so `get_flow`
 * spends its budget on it last and expands it once (P92).
 */
@Injectable()
export class AppLogger {
  private readonly lines: string[] = [];

  log(message: string, context: string): void {
    this.write(this.format(message, context));
  }

  private format(message: string, context: string): string {
    return `${this.stamp()} [${context}] ${this.redact(message)}`;
  }

  private stamp(): string {
    return new Date().toISOString();
  }

  private redact(message: string): string {
    return this.mask(message, /card=\d+/g);
  }

  private mask(text: string, pattern: RegExp): string {
    return text.replace(pattern, 'card=***');
  }

  private write(line: string): void {
    this.lines.push(this.serialize(line));
  }

  private serialize(line: string): string {
    return JSON.stringify({ line });
  }
}

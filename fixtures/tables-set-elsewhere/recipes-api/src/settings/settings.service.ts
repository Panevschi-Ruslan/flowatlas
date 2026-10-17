import { Injectable } from '@nestjs/common';

/** Values the deployment chooses, read at run time. */
@Injectable()
export class SettingsService {
  private readonly values = new Map<string, string>();

  valueOf(key: string): string {
    return this.values.get(key) ?? key;
  }
}

import { Injectable } from '@nestjs/common';

/** Text, and nothing else. There is no store behind any of this. */
@Injectable()
export class TemplatesService {
  greeting(name: string): string {
    return `Hello ${name}`;
  }

  farewell(name: string): string {
    return `Goodbye ${name}`;
  }
}

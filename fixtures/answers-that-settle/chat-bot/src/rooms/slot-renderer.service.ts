import { Injectable } from '@nestjs/common';

/** A way of writing free times, registered when the code runs. */
export interface SlotFormat {
  readonly name: string;
  format(slots: string[]): string;
}

/** Renders free times in the style a setting names, through formats registered when the code runs: off the request's way. */
@Injectable()
export class SlotRenderer {
  private readonly formats: SlotFormat[] = [];
  private style = 'list';

  use(format: SlotFormat): void {
    this.formats.push(format);
    this.style = format.name;
  }

  render(slots: string[]): string {
    const chosen = this.formats.find((each) => each.name === this.style);
    return chosen === undefined ? slots.join(', ') : chosen.format(slots);
  }
}

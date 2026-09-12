import { Body, Controller, Post } from '@nestjs/common';

import { WireBrokenDto, WireDto } from './wire.dto';

/** The two routes the wire rules are measured on. */
@Controller('wire')
export class WireController {
  /** Every rule at once, and not one finding above a warning. */
  @Post()
  accept(@Body() body: WireDto): Promise<void> {
    return Promise.resolve();
  }

  /** The control: a real break the rules must still report. */
  @Post('broken')
  broken(@Body() body: WireBrokenDto): Promise<void> {
    return Promise.resolve();
  }
}

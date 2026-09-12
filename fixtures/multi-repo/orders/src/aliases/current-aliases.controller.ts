import { Controller, Get, Param } from '@nestjs/common';

/**
 * The other half of the deliberate duplicate: the same method and the same
 * normalised path as `LegacyAliasesController.resolve`, in a second controller.
 * See that file for what must happen; the two candidates are what make
 * `GET /a/:param` ambiguous.
 */
@Controller('a')
export class CurrentAliasesController {
  @Get(':slug')
  resolve(@Param('slug') slug: string): { target: string } {
    return { target: `/orders/${slug}` };
  }
}

import { Controller, Get, Param } from '@nestjs/common';

/**
 * One half of the deliberate duplicate.
 *
 * `GET /a/:param` is declared here and again in
 * `current-aliases.controller.ts`, and both controllers are registered in
 * `app.module.ts`, so a client call to that route matches two entries and the
 * linker must refuse to guess: no edge, unresolved `ambiguous-route` with both
 * candidates in the hint (§10, row 9).
 *
 * Nothing in this fixture calls `/a/:id`, which is why `httpOut.ambiguous` is 0
 * in §12: the pair is here for `matchRoute`'s own tests, and both entries land
 * in `routes.uncalled`.
 */
@Controller('a')
export class LegacyAliasesController {
  @Get(':id')
  resolve(@Param('id') id: string): { target: string } {
    return { target: `/orders/${id}` };
  }
}

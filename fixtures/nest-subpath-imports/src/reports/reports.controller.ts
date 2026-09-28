import { Controller } from '@nestjs/common';
import { Get as HttpGet } from '@nestjs/common/decorators';

/**
 * Both spellings in one class, and the verb under a name of its own.
 *
 * `@Controller` from the package and the verb from a subpath of it, which is what
 * A notification service's workflow and layout controllers do. The alias is here because the table
 * of verbs is keyed by the names the package exports, and a table asked only for
 * the name written in the file has no answer for this one — which used to mean a
 * `continue` and a route that existed nowhere.
 */
@Controller('reports')
export class ReportsController {
  @HttpGet('daily')
  daily(): string[] {
    return [];
  }
}

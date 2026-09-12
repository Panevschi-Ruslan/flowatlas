import { Injectable } from '@nestjs/common';

/**
 * Registered in the module, injected by nobody, exported by nobody.
 *
 * The one row `flowatlas dead --kind providers` should produce here. Everything
 * else in this repository is either injected, a controller, or exported.
 */
@Injectable()
export class UnusedService {
  describe(): string {
    return 'nothing reaches this';
  }
}

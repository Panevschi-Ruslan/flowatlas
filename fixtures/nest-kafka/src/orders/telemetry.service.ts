import { Injectable } from '@nestjs/common';

/**
 * A local class with a method called `emit`. Its type origin is this repo, not a
 * broker package and not an `adapters.broker.custom` entry, so §10's
 * "receiver origin is not a known broker package" row applies: calls on it are
 * ordinary method calls owned by P01 and must produce no `producer` node.
 *
 * The fixture would pass by accident if the adapter keyed on the method name.
 */
@Injectable()
export class TelemetryService {
  emit(name: string, attributes: Record<string, unknown>): void {
    void name;
    void attributes;
  }
}

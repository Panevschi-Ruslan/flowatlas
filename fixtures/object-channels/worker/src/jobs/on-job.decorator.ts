import { SetMetadata } from '@nestjs/common';

/**
 * The decorator a project of this shape marks its handlers with.
 *
 * The channel is a property of the options object, exactly as on the publishing
 * side — which is the point: both ends write the name the same way, so both ends
 * have to be describable the same way. Until a description could say "a property
 * of argument 0" on this side too, a project could describe its publishers and
 * not its handlers, and every channel it had came out with one end and joined
 * nothing.
 */
export interface JobConfig {
  readonly name: string;
  readonly queue?: string;
}

export const OnJob = (config: JobConfig): MethodDecorator =>
  SetMetadata('job-config', config);

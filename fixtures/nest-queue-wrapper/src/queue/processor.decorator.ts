import { SetMetadata, type Scope } from '@nestjs/common';

import type { QueueName } from './queue-name';

export const PROCESSOR_METADATA = 'queue:processor';
export const PROCESS_METADATA = 'queue:process';

export interface ProcessorOptions {
  queueName: QueueName;
  scope?: Scope;
}

/**
 * The shop's own worker decorator: the queue named as a word, or in an options
 * object beside the scope the worker is built in.
 */
export function Processor(queueNameOrOptions: string | ProcessorOptions): ClassDecorator {
  const options = typeof queueNameOrOptions === 'object' ? queueNameOrOptions : { queueName: queueNameOrOptions };
  return (target: Function) => {
    SetMetadata(PROCESSOR_METADATA, options)(target);
  };
}

/** The job of the queue a method handles. */
export function Process(jobName: string): MethodDecorator {
  return SetMetadata(PROCESS_METADATA, { jobName });
}

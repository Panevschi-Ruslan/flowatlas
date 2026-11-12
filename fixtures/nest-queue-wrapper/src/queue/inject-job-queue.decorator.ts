import { Inject } from '@nestjs/common';

import type { QueueName } from './queue-name';
import { queueToken } from './queue-token';

/** Asks the container for the service of one queue, by the queue's name. */
export const InjectJobQueue = (name: QueueName): PropertyDecorator & ParameterDecorator => Inject(queueToken(name));

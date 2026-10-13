import type { DeliveryTarget } from '@flowatlas/core';
import { asText, type Instance, type Value } from '../eval/values.js';
import { argument, blockOrArgument, entryOf, siteOf, textOf, unreadRow } from './arguments.js';
import { deployedAt, isBecause, targetOf } from './deployed.js';
import { filtersIn, sourceOf } from './queues.js';
import type { ResourceReader, ResourceReading } from './reading.js';

/**
 * EventBridge Pipes: one source read in order, handed to one target.
 *
 * The same two halves a mapping has - a queue or a stream on one side, and on
 * the other a function, a workflow, a queue, a topic or a bus - declared as one
 * resource. A bus target may give the event its source and detail type, and
 * then the pipe is a publisher of exactly that event.
 */

/** The fields of the event a pipe puts on a bus, as its target parameters write them. */
const eventFields = (pipe: Instance): Record<string, string> | undefined => {
  const parameters = blockOrArgument(pipe, 'target_parameters');
  const bus: Value | undefined = entryOf(parameters, 'eventbridge_event_bus_parameters');
  const source = entryOf(bus, 'source');
  const detailType = entryOf(bus, 'detail_type');
  const fields = {
    ...(source === undefined || asText(source) === undefined ? {} : { source: asText(source) as string }),
    ...(detailType === undefined || asText(detailType) === undefined ? {} : { 'detail-type': asText(detailType) as string }),
  };
  return Object.keys(fields).length === 0 ? undefined : fields;
};

const readPipe = (pipe: Instance, reading: ResourceReading): void => {
  const found = deployedAt(pipe, 'source', reading);
  const from = found === undefined ? { reason: 'absent', text: 'source is not set' } : isBecause(found) ? found : sourceOf(found);
  if ('reason' in from) {
    reading.rows.push(unreadRow(pipe, 'subscription-source-unread', `what ${pipe.address} reads`, from, from.reason === 'unplaced' ? 'info' : undefined));
    return;
  }
  const target = targetOf(deployedAt(pipe, 'target', reading), pipe, `the target of ${pipe.address}`, reading);
  const fields = target?.kind === 'bus' ? eventFields(pipe) : undefined;
  const to: DeliveryTarget | undefined = target?.kind === 'bus' && fields !== undefined ? { ...target, fields } : target;
  const name = textOf(argument(pipe, 'name'));
  const filters = filtersIn(entryOf(blockOrArgument(pipe, 'source_parameters'), 'filter_criteria'));
  reading.deliveries.push({
    ...siteOf(pipe),
    address: pipe.address,
    by: 'pipe',
    ...(name === undefined ? {} : { name }),
    from,
    ...(to === undefined ? {} : { to }),
    ...(filters.length === 0 ? {} : { meta: { unmatched: { filter: filters } } }),
  });
};

export const PIPE_READERS: readonly ResourceReader[] = [['aws_pipes_pipe', readPipe]];

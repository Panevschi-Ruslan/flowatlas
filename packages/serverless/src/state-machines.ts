import { DEFAULT_EVENT_BUS, deployedArn, deployedNameIn, eventPatternOf } from '@flowatlas/aws';
import { generatedName, type DeliverySource, type DeployedWorkflow, type PathStep } from '@flowatlas/core';
import { intrinsicOf, type Deployed, type Resource } from './cloudformation.js';
import type { FileReading } from './reading.js';
import { HOLE, isRecord, textOf, Unread } from './variables.js';

/**
 * State machines a service declares (P57): under `stepFunctions.stateMachines`,
 * as the `serverless-step-functions` plugin reads them, and as
 * `AWS::StepFunctions::StateMachine` resources.
 *
 * A definition written in the service file is handed over as a value with a
 * line for every member (P22's `DeployedDefinition` of kind `value`), so each
 * state is drawn at the line it is written on. A reference inside it - a
 * function by its key or its logical id, `!GetAtt`, `!Ref`, a value read from
 * a variable that is not settled - is left in its place as a `${…}`
 * placeholder, which `fill` answers with the ARN of what it names, as
 * Terraform's templates are answered: the reader of definitions then needs no
 * second way to read a name.
 */

/** A definition with every reference in it replaced by a placeholder, and what each stands for. */
class Placeholders {
  readonly #values = new Map<string, unknown>();

  put(value: unknown): string {
    const key = `ref${this.#values.size}`;
    this.#values.set(key, value);
    return `\${${key}}`;
  }

  value(key: string): unknown {
    return this.#values.get(key);
  }

  /** The definition with each reference that is not plain text in place of a placeholder. */
  replace(value: unknown, depth = 0): unknown {
    if (depth > 64) return value;
    if (value instanceof Unread) return this.put(value);
    if (intrinsicOf(value) !== undefined) return this.put(value);
    if (Array.isArray(value)) return value.map((item) => this.replace(item, depth + 1));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.replace(item, depth + 1)]));
    return value;
  }
}

/** What a placeholder is once the deployment fills it in, spelled as a definition would hold it. */
const filled = (found: Deployed | Unread | undefined): string | undefined => {
  if (found === undefined || found instanceof Unread || found.kind === 'url') return undefined;
  return deployedArn(found.kind, found.name);
};

/** A reference, from the definition, to what it names: a function by key as the plugin allows, or anything the template knows. */
export const answerFor = (reading: FileReading, value: unknown): string | undefined => {
  const intrinsic = intrinsicOf(value);
  if (intrinsic !== undefined && intrinsic[0] === 'Fn::GetAtt') {
    const argument = intrinsic[1];
    const id = Array.isArray(argument) ? argument[0] : typeof argument === 'string' ? argument.split('.')[0] : undefined;
    const byKey = typeof id === 'string' ? reading.functionNamed(id) : undefined;
    if (byKey !== undefined) return filled(byKey);
  }
  if (intrinsic !== undefined && intrinsic[0] === 'Ref' && typeof intrinsic[1] === 'string') {
    const byKey = reading.functionNamed(intrinsic[1]);
    if (byKey !== undefined) return filled(byKey);
  }
  if (value instanceof Unread && value.partial !== undefined) {
    const found = deployedNameIn(value.partial);
    return found === undefined || found.name.includes(HOLE) ? undefined : deployedArn(found.kind, found.name);
  }
  return filled(reading.template.deployedOf(value));
};

/** A workflow from a definition value written at `path` of the file. */
export const workflowOf = (
  reading: FileReading,
  address: string,
  path: readonly PathStep[],
  definitionPath: readonly PathStep[],
  definition: unknown,
  name: string | undefined,
  substitutions: Readonly<Record<string, unknown>>,
  meta: Record<string, unknown>,
): DeployedWorkflow => {
  const placeholders = new Placeholders();
  const value = placeholders.replace(definition);
  return {
    ...reading.siteOf(path),
    ...(name === undefined ? {} : { name }),
    address,
    definition: {
      kind: 'value',
      file: reading.file,
      value,
      at: (inner) => {
        const at = reading.document.at([...definitionPath, ...inner]);
        return at ?? reading.document.at(definitionPath);
      },
    },
    fill: (key) => {
      const own = placeholders.value(key);
      if (own !== undefined) return answerFor(reading, own);
      const substitution = substitutions[key];
      return substitution === undefined ? undefined : (textOf(substitution) ?? answerFor(reading, substitution));
    },
    meta: { declaredAs: address, ...meta },
  };
};

/** A workflow whose name is generated says so, and is named by its declaration. */
export const workflowNameOf = (reading: FileReading, written: unknown, address: string, path: readonly PathStep[]): { name?: string; reference?: string } => {
  if (written === undefined || written === null) {
    reading.generatedRow({ kind: 'workflow', name: generatedName(address), generated: true }, path);
    return { reference: generatedName(address) };
  }
  const name = textOf(written);
  if (name !== undefined) return { name, reference: name };
  reading.row(path, address, {
    reason: 'workflow-name-unread',
    message: `the name of ${address} is not read: ${written instanceof Unread ? written.text : 'it is not text'}`,
    hint: 'Nothing can start a workflow whose name is not read. Write the name so the file settles it. Its steps are still drawn.',
  });
  return {};
};

/** One event of a state machine of the plugin: a schedule or a rule, onto the workflow. */
const readWorkflowEvent = (reading: FileReading, event: unknown, workflow: string | undefined, address: string, path: readonly PathStep[]): void => {
  const [type] = isRecord(event) ? Object.keys(event) : [];
  if (type === undefined || !isRecord(event)) return;
  const settings = event[type];
  const to = workflow === undefined ? undefined : { kind: 'workflow' as const, name: workflow };
  const push = (from: DeliverySource, by: 'schedule' | 'rule', name?: string, meta: Record<string, unknown> = {}): void => {
    reading.parts.deliveries.push({ ...reading.siteOf(path), address, by, ...(name === undefined ? {} : { name }), from, ...(to === undefined ? {} : { to }), ...(Object.keys(meta).length === 0 ? {} : { meta }) });
  };
  if (type === 'schedule') {
    const options = isRecord(settings) ? settings : { rate: settings };
    const rate = textOf(options['rate']);
    push({ kind: 'schedule', ...(rate === undefined ? {} : { expression: rate }) }, 'schedule', textOf(options['name']), options['enabled'] === false ? { disabled: true } : {});
    return;
  }
  if (type === 'eventBridge' || type === 'cloudwatchEvent') {
    const options = isRecord(settings) ? settings : {};
    const bus = textOf(options['eventBusName']) ?? DEFAULT_EVENT_BUS;
    const pattern = eventPatternOf(options['event']);
    if ('reason' in pattern) {
      reading.row(path, address, { reason: 'event-pattern-unread', message: `the event of ${address} is not read: ${pattern.text}`, hint: 'Write the event as a mapping of fields to lists of values.' });
      return;
    }
    push({ kind: 'bus', name: deployedNameIn(bus)?.name ?? bus, pattern }, 'rule', textOf(options['name']), options['enabled'] === false ? { disabled: true } : {});
    return;
  }
  const hint = 'The workflow is still drawn and joined by its name; this way of starting it is not.';
  if (type === 'http') {
    reading.row(path, address, { reason: 'route-target-unread', message: `${address} is a route that starts the workflow, and a route onto a workflow is not drawn`, hint });
    return;
  }
  reading.row(path, address, { reason: 'invoker-not-read', level: 'info', message: `${address} starts the workflow on ${type} events, which are not read`, hint });
};

/** `stepFunctions.stateMachines`, as the plugin reads them. */
export const readPluginStateMachines = (reading: FileReading, stateMachines: unknown): void => {
  if (!isRecord(stateMachines)) return;
  for (const [key, machine] of Object.entries(stateMachines)) {
    if (!isRecord(machine)) continue;
    const path = ['stepFunctions', 'stateMachines', key];
    const address = `stepFunctions.stateMachines.${key}`;
    const { name, reference } = workflowNameOf(reading, machine['name'], address, path);
    if (machine['definition'] === undefined) {
      reading.row(path, address, { reason: 'workflow-definition-not-loaded', message: `${address} has no definition written in the file`, hint: 'Nothing of this workflow is drawn. Write the definition under definition.' });
    } else {
      reading.parts.workflows.push(
        workflowOf(reading, address, path, [...path, 'definition'], machine['definition'], name, {}, {
          ...(name === undefined ? { nameGenerated: true } : {}),
          ...(textOf(machine['type']) === undefined ? {} : { type: textOf(machine['type']) }),
        }),
      );
    }
    const events = Array.isArray(machine['events']) ? machine['events'] : [];
    events.forEach((event, index) => readWorkflowEvent(reading, event, reference, `${address}.events[${index}]`, [...path, 'events', index]));
  }
};

/** An `AWS::StepFunctions::StateMachine` resource: its definition, as an object or as JSON text. */
export const readStateMachineResource = (reading: FileReading, resource: Resource): void => {
  const path = [...resource.path];
  const { properties } = resource;
  const { name } = workflowNameOf(reading, properties['StateMachineName'], resource.address, path);
  let substitutions: Record<string, unknown> = isRecord(properties['DefinitionSubstitutions']) ? properties['DefinitionSubstitutions'] : {};
  let definition: unknown = properties['Definition'];
  let definitionPath: PathStep[] = [...path, 'Properties', 'Definition'];
  if (definition === undefined) {
    // JSON text, written out or through Fn::Sub, whose variables are filled the way substitutions are.
    const written = properties['DefinitionString'];
    const sub = intrinsicOf(written);
    const subArgument = sub?.[0] === 'Fn::Sub' ? sub[1] : undefined;
    const subText = Array.isArray(subArgument) ? subArgument[0] : subArgument;
    if (Array.isArray(subArgument) && isRecord(subArgument[1])) substitutions = { ...subArgument[1], ...substitutions };
    const text = textOf(written) ?? textOf(subText);
    definitionPath = [...path, 'Properties', 'DefinitionString'];
    try {
      definition = text === undefined ? undefined : (JSON.parse(text) as unknown);
    } catch {
      definition = undefined;
    }
  }
  if (definition === undefined) {
    reading.row(path, resource.address, {
      reason: 'workflow-definition-not-loaded',
      message: `the definition of ${resource.address} is not read: it is neither a Definition written out nor a DefinitionString of JSON`,
      hint: 'Nothing of this workflow is drawn. Write the definition under Definition, or as JSON text.',
    });
    return;
  }
  reading.parts.workflows.push(
    workflowOf(reading, resource.address, path, definitionPath, definition, name, substitutions, name === undefined ? { nameGenerated: true } : {}),
  );
};

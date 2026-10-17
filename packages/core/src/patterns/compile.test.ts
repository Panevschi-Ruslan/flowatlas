import { describe, expect, it } from 'vitest';
import { compilePattern, isCompiled, opOfName, type CompiledRule } from './compile.js';
import { patternRuleSchema, type PatternRule } from './schema.js';

const rule = (written: Record<string, unknown>): PatternRule =>
  patternRuleSchema.parse({ id: 'r', kind: 'publish', ...written });

const compiled = (written: Record<string, unknown>): CompiledRule => {
  const result = compilePattern(rule(written));
  if (!isCompiled(result)) throw new Error(`refused: ${result.refused.part}: ${result.refused.reason}`);
  return result.compiled;
};

const refused = (written: Record<string, unknown>): { part: string; reason: string } => {
  const result = compilePattern(rule(written));
  if (isCompiled(result)) throw new Error('compiled');
  return result.refused;
};

const producerOf = (written: Record<string, unknown>) => {
  const { descriptor } = compiled(written);
  if (descriptor.slot !== 'broker') throw new Error(descriptor.slot);
  return descriptor.broker.producers[0];
};

describe('compilePattern: where each hole is', () => {
  it('turns a hole in an object argument into argument-property, order-free', () => {
    const producer = producerOf({
      on: { receiverType: 'ShopBus' },
      pattern: '$BUS.emit({ data: $PAYLOAD, topic: $CHANNEL })',
      channel: '$CHANNEL',
      payload: '$PAYLOAD',
    });
    expect(producer).toMatchObject({
      method: 'emit',
      receiverType: 'ShopBus',
      channel: [{ kind: 'argument-property', index: 0, key: 'topic' }],
      payload: [{ kind: 'argument-property', index: 0, key: 'data' }],
      describedBy: 'pattern:r',
    });
  });

  it('reads a plain argument, a deeper path and a list element', () => {
    expect(producerOf({ on: { receiverType: 'Bus' }, pattern: '$B.send(_, $C)', channel: '$C' })?.channel).toEqual([
      { kind: 'argument', index: 1 },
    ]);
    expect(
      producerOf({ on: { receiverType: 'Bus' }, pattern: '$B.send({ meta: { topic: $C } })', channel: '$C' })?.channel,
    ).toEqual([{ kind: 'argument-path', index: 0, path: ['meta', 'topic'] }]);
    expect(
      producerOf({ on: { receiverType: 'Bus' }, pattern: '$B.put({ Entries: [{ DetailType: $T }] })', channel: '$T' })?.channel,
    ).toEqual([{ kind: 'argument-path', index: 0, path: ['Entries', '*', 'DetailType'] }]);
  });

  it('reads the chain: a hole further up is chain-call, one in the root call chain-root-argument', () => {
    expect(
      producerOf({ on: { receiverType: 'Queue' }, pattern: '$CLIENT.queue($Q).add($JOB, $PAYLOAD)', channel: '$Q', payload: '$PAYLOAD' }),
    ).toMatchObject({ method: 'add', channel: [{ kind: 'chain-call', method: 'queue', index: 0 }], payload: [{ kind: 'argument', index: 1 }] });
    expect(
      producerOf({ on: { receiverType: 'Topic' }, pattern: 'topic($NAME).publish($DATA)', channel: '$NAME' })?.channel,
    ).toEqual([{ kind: 'chain-root-argument', index: 0 }]);
  });

  it('reads the receiver and its forms', () => {
    expect(producerOf({ on: { receiverType: 'Queue' }, pattern: '$Q.add($JOB)', channel: '$Q' })?.channel).toEqual([{ kind: 'receiver' }]);
    expect(producerOf({ on: { receiverType: 'Queue' }, pattern: '$Q.add($JOB)', channel: '$Q:type' })?.channel).toEqual([
      { kind: 'receiver-type' },
    ]);
    expect(producerOf({ on: { receiverType: 'Queue' }, pattern: '$Q.add($JOB)', channel: '$Q:constructor(0)' })?.channel).toEqual([
      { kind: 'base-constructor-argument', index: 0 },
    ]);
    expect(
      producerOf({ on: { receiverType: 'Queue' }, pattern: '$Q.add($JOB)', channel: '$Q:decorator(InjectQueue, 0)' })?.channel,
    ).toEqual([{ kind: 'provider-decorator', decorator: 'InjectQueue', index: 0 }]);
  });

  it('reads a construction handed to the call, and one the receiver is', () => {
    expect(
      producerOf({ on: { receiverType: 'Client' }, pattern: '$C.send(new SendCommand({ Name: $N }))', channel: '$N' })?.channel,
    ).toEqual([{ kind: 'constructed-argument-path', class: 'SendCommand', path: ['Name'], index: 0 }]);
    expect(producerOf({ pattern: 'new Upload({ params: { Bucket: $B } }).done()', channel: '$B' })).toMatchObject({
      receiverType: 'Upload',
      channel: [{ kind: 'receiver-constructed-path', class: 'Upload', path: ['params', 'Bucket'], index: 0 }],
    });
  });

  it('makes a literal a condition the call must meet', () => {
    expect(
      producerOf({ on: { receiverType: 'Bus' }, pattern: "$B.send({ kind: 'event', name: $N })", channel: '$N' })?.where,
    ).toEqual([{ at: { kind: 'argument-property', index: 0, key: 'kind' }, equals: 'event' }]);
  });

  it('names a function called by its name, with its module', () => {
    expect(producerOf({ on: { module: '@acme/bus' }, pattern: 'emitEvent($NAME, $DATA)', channel: '$NAME', payload: '$DATA' })).toMatchObject({
      function: 'emitEvent',
      module: '@acme/bus',
      channel: [{ kind: 'argument', index: 0 }],
    });
  });

  it('writes a fixed channel as an address of one literal part', () => {
    expect(producerOf({ on: { receiverType: 'Bus' }, pattern: '$B.ping()', channel: 'heartbeat' })?.address).toEqual([{ literal: 'heartbeat' }]);
  });
});

describe('compilePattern: each kind', () => {
  it('compiles a subscription with its handler argument', () => {
    const { descriptor } = compiled({ kind: 'subscribe', on: { receiverType: 'ShopBus' }, pattern: '$BUS.on($CHANNEL, $HANDLER)', channel: '$CHANNEL', handler: '$HANDLER' });
    expect(descriptor.slot === 'broker' && descriptor.broker.subscribers[0]).toMatchObject({
      receiverType: 'ShopBus',
      method: 'on',
      channel: [{ kind: 'argument', index: 0 }],
      handlerArg: 1,
    });
  });

  it('compiles a decorator, and reads its argument', () => {
    const { descriptor } = compiled({ kind: 'consume-decorator', pattern: '@OnEvent({ name: $CHANNEL })', channel: '$CHANNEL' });
    expect(descriptor.slot === 'broker' && descriptor.broker.consumers[0]).toMatchObject({
      decorator: 'OnEvent',
      channel: [{ kind: 'argument-property', index: 0, key: 'name' }],
    });
  });

  it('compiles a start', () => {
    const { descriptor } = compiled({ kind: 'start', on: { module: '@acme/flows' }, pattern: 'runFlow($NAME, _)', name: '$NAME', target: 'workflow' });
    expect(descriptor).toMatchObject({ slot: 'starter', starter: { function: 'runFlow', module: '@acme/flows', target: 'workflow', name: [{ kind: 'argument', index: 0 }] } });
  });

  it('compiles a table access, the operation from the method name or fixed', () => {
    expect(compiled({ kind: 'table', on: { module: '@acme/data' }, pattern: 'insertRow($TABLE, _)', table: '$TABLE' }).descriptor).toMatchObject({
      slot: 'table',
      table: { name: 'insertRow', package: '@acme/data', table: 0, op: 'write' },
    });
    expect(compiled({ kind: 'table', pattern: 'useDb().select($T)', table: '$T' }).descriptor).toMatchObject({
      slot: 'table',
      table: { name: 'select', factory: 'useDb', table: 0, op: 'read' },
    });
    expect(compiled({ kind: 'table', pattern: 'purgeAudit()', table: 'audit_log', op: 'delete' }).descriptor).toMatchObject({
      slot: 'table',
      table: { name: 'purgeAudit', table: 'audit_log', op: 'delete' },
    });
  });

  it('compiles a request: verb from a hole, fixed, or the method name', () => {
    expect(
      compiled({ kind: 'http-request', on: { receiverType: 'ApiClient' }, pattern: '$API.call($VERB, $URL, $BODY)', verb: '$VERB', url: '$URL', body: '$BODY' })
        .descriptor,
    ).toMatchObject({
      slot: 'http',
      client: {
        receiverType: 'ApiClient',
        method: 'call',
        verbAt: [{ kind: 'argument', index: 0 }],
        url: [{ kind: 'argument', index: 1 }],
        body: [{ kind: 'argument', index: 2 }],
      },
    });
    expect(compiled({ kind: 'http-request', pattern: 'useApi().send({ path: $P })', url: '$P', verb: 'post' }).descriptor).toMatchObject({
      slot: 'http',
      client: { factory: 'useApi', method: 'send', verb: 'POST', url: [{ kind: 'argument-property', index: 0, key: 'path' }] },
    });
    const byName = compiled({ kind: 'http-request', on: { receiverType: 'Http' }, pattern: '$H.delete($URL)', url: '$URL' }).descriptor;
    expect(byName.slot === 'http' && byName.client.verb).toBeUndefined();
  });

  it('reads the operation a name starts with', () => {
    expect(opOfName('findById')).toBe('read');
    expect(opOfName('upsertMany')).toBe('write');
    expect(opOfName('removeAll')).toBe('delete');
    expect(opOfName('frobnicate')).toBeUndefined();
  });
});

describe('compilePattern: what is refused, with the part named', () => {
  it('a hole inside a callback', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit((e) => $C)', channel: '$C' })).toMatchObject({ part: 'argument 0 of emit()' });
  });

  it('a spread', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit(...$ARGS)', channel: '$ARGS' }).reason).toMatch(/spread/);
  });

  it('a hole after a run of arguments, and a run used as a place', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit($$$REST, $C)', channel: '$C' }).reason).toMatch(/run of arguments/);
  });

  it('a field naming a hole the pattern does not have', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit($C)', channel: '$X' })).toMatchObject({ part: 'channel' });
  });

  it('a method call with no receiver type', () => {
    expect(refused({ pattern: '$B.emit($C)', channel: '$C' })).toMatchObject({ part: 'on.receiverType' });
  });

  it('a receiver written as a name', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: 'bus.emit($C)', channel: '$C' })).toMatchObject({ part: 'the receiver' });
  });

  it('a request whose verb is nowhere', () => {
    expect(refused({ kind: 'http-request', on: { receiverType: 'Api' }, pattern: '$A.call($URL)', url: '$URL' })).toMatchObject({ part: 'verb' });
  });

  it('a pattern that does not parse', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit(', channel: '$C' })).toMatchObject({ part: 'pattern' });
  });

  it('a decorator under a kind that is not one', () => {
    expect(refused({ pattern: '@OnEvent($C)', channel: '$C' })).toMatchObject({ part: 'pattern' });
  });

  it('a hole written twice', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.emit($C, $C)', channel: '$C' }).reason).toMatch(/twice/);
  });

  it('a construction with nothing in it to match', () => {
    expect(refused({ on: { receiverType: 'Bus' }, pattern: '$B.send(new Ping(), $C)', channel: '$C' }).reason).toMatch(/holds no hole/);
  });
});

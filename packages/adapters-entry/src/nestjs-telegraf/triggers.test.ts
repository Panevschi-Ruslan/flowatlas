import { Project, type ClassDeclaration, type Decorator } from 'ts-morph';
import { beforeAll, describe, expect, it } from 'vitest';
import { isTelegrafDecorator, resolveTriggerArg, stepTrigger } from './triggers.js';

const LIBRARY = `
export type Trigger = string | RegExp;
export declare const Action: (triggers: Trigger | Trigger[]) => MethodDecorator;
export declare const Command: (command: string | string[]) => MethodDecorator;
export declare const WizardStep: (step: number) => MethodDecorator;
`;

const SHARED = `export declare const SHARED: { readonly PAY: 'pay_now' };`;

const LOCAL = `export const Action = (event: string): MethodDecorator => () => undefined;`;

const SOURCE = `
import { Action, Action as Btn, Command, WizardStep } from 'nestjs-telegraf';
import { Action as CqrsAction } from './cqrs-like.js';
import { SHARED } from '@shared/callbacks';

export const CB = { CANCEL: 'order_cancel' } as const;
export enum Callbacks { Confirm = 'order_confirm' }
const buildKey = (): string => 'order_' + String(Date.now());

export class Handlers {
  @Command('menu') literal() {}
  @Command(['orders', 'o']) list() {}
  @Action(/^order_(\\d+)$/i) pattern() {}
  @Action([CB.CANCEL, /^pay_/]) mixed() {}
  @Action(CB.CANCEL) fromConst() {}
  @Action(Callbacks.Confirm) fromEnum() {}
  @Action(SHARED.PAY) fromPackage() {}
  @Action(buildKey()) dynamic() {}
  @Btn('renamed') aliased() {}
  @CqrsAction('order.created') foreign() {}
  @WizardStep(2) step() {}
  @WizardStep(Number('2')) dynamicStep() {}
}
`;

/** The handler class, with the library and a same-named local decorator around it. */
const parseHandlers = (): ClassDeclaration => {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { experimentalDecorators: true, strict: false },
  });
  project.createSourceFile('/node_modules/nestjs-telegraf/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/nestjs-telegraf/index.d.ts', LIBRARY);
  project.createSourceFile('/node_modules/@shared/callbacks/package.json', '{"types":"index.d.ts"}');
  project.createSourceFile('/node_modules/@shared/callbacks/index.d.ts', SHARED);
  project.createSourceFile('/cqrs-like.ts', LOCAL);
  return project.createSourceFile('/orders.update.ts', SOURCE).getClassOrThrow('Handlers');
};

let handlers: ClassDeclaration;

beforeAll(() => {
  handlers = parseHandlers();
});

const decoratorOf = (method: string): Decorator => {
  const decorator = handlers.getMethodOrThrow(method).getDecorators()[0];
  if (decorator === undefined) throw new Error(`no decorator on ${method}`);
  return decorator;
};

const triggersOf = (method: string) => {
  const [argument] = decoratorOf(method).getArguments();
  if (argument === undefined) throw new Error(`no argument on ${method}`);
  return resolveTriggerArg(argument);
};

describe('reading what a handler is registered under', () => {
  it('reads a string literal', () => {
    expect(triggersOf('literal')).toEqual({
      resolved: true,
      triggers: [{ kind: 'text', value: 'menu' }],
    });
  });

  it('fans an array out into one trigger per element', () => {
    expect(triggersOf('list')).toEqual({
      resolved: true,
      triggers: [
        { kind: 'text', value: 'orders' },
        { kind: 'text', value: 'o' },
      ],
    });
  });

  it('keeps a pattern as its source and its flags', () => {
    expect(triggersOf('pattern')).toEqual({
      resolved: true,
      triggers: [{ kind: 'regex', source: '^order_(\\d+)$', flags: 'i' }],
    });
  });

  it('reads a list that mixes a constant and a pattern', () => {
    expect(triggersOf('mixed')).toEqual({
      resolved: true,
      triggers: [
        { kind: 'text', value: 'order_cancel' },
        { kind: 'regex', source: '^pay_', flags: '' },
      ],
    });
  });

  it('follows a const, an enum member and a constant from another package', () => {
    expect(triggersOf('fromConst')).toEqual({
      resolved: true,
      triggers: [{ kind: 'text', value: 'order_cancel' }],
    });
    expect(triggersOf('fromEnum')).toEqual({
      resolved: true,
      triggers: [{ kind: 'text', value: 'order_confirm' }],
    });
    expect(triggersOf('fromPackage')).toEqual({
      resolved: true,
      triggers: [{ kind: 'text', value: 'pay_now' }],
    });
  });

  it('gives up on a key built at run time, and says what it saw', () => {
    expect(triggersOf('dynamic')).toEqual({ resolved: false, text: 'buildKey()' });
  });

  it('reads a step number only when it is written as one', () => {
    expect(stepTrigger(decoratorOf('step'))).toEqual({ kind: 'step', index: 2 });
    expect(stepTrigger(decoratorOf('dynamicStep'))).toBeUndefined();
  });
});

describe('deciding whether a decorator is the library one', () => {
  it('matches a decorator imported under another name', () => {
    expect(isTelegrafDecorator(decoratorOf('aliased'), ['Action'])).toBe(true);
  });

  it('rejects a decorator of the same name from somewhere else', () => {
    expect(isTelegrafDecorator(decoratorOf('foreign'), ['Action'])).toBe(false);
  });

  it('rejects a decorator this adapter is not looking for', () => {
    expect(isTelegrafDecorator(decoratorOf('literal'), ['Action'])).toBe(false);
  });
});

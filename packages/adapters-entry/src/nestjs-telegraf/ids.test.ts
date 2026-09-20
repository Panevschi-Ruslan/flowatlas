import { describe, expect, it } from 'vitest';
import { deriveKey, entryMeta } from './ids.js';
import type { BotTrigger } from './triggers.js';

describe('deriving the key half of a bot entry id', () => {
  it('drops the slash a command may be written with', () => {
    expect(deriveKey('Command', { kind: 'text', value: '/start' })).toBe('start');
    expect(deriveKey('Command', { kind: 'text', value: 'start' })).toBe('start');
  });

  it('names the command after the decorator when it takes no argument', () => {
    expect(deriveKey('Start', { kind: 'none' })).toBe('start');
    expect(deriveKey('Help', { kind: 'none' })).toBe('help');
  });

  it('keeps text a phrase handler matches exactly as written', () => {
    expect(deriveKey('Hears', { kind: 'text', value: '/menu' })).toBe('/menu');
    expect(deriveKey('Hears', { kind: 'text', value: 'Depots' })).toBe('Depots');
  });

  it('writes a pattern back as the literal it was written as', () => {
    expect(deriveKey('Action', { kind: 'regex', source: '^order_(\\d+)$', flags: '' })).toBe(
      '/^order_(\\d+)$/',
    );
    expect(deriveKey('Hears', { kind: 'regex', source: '^hi', flags: 'i' })).toBe('/^hi/i');
  });

  it('prefixes a handler declared inside a scene with the scene', () => {
    expect(deriveKey('On', { kind: 'text', value: 'text' }, 'checkout')).toBe('checkout/text');
    expect(deriveKey('On', { kind: 'text', value: 'text' })).toBe('text');
  });

  it('keys a scene step by the scene and the step', () => {
    expect(deriveKey('SceneEnter', { kind: 'none' }, 'checkout')).toBe('checkout#enter');
    expect(deriveKey('SceneLeave', { kind: 'none' }, 'checkout')).toBe('checkout#leave');
    expect(deriveKey('WizardStep', { kind: 'step', index: 4 }, 'register')).toBe('register#4');
  });

  it('gives each element of an array its own key', () => {
    const triggers: BotTrigger[] = [
      { kind: 'text', value: 'orders' },
      { kind: 'text', value: 'o' },
    ];
    expect(triggers.map((trigger) => deriveKey('Command', trigger))).toEqual(['orders', 'o']);
  });
});

describe('what a bot entry records about itself', () => {
  it('carries the callback data a button sends back, pattern or string', () => {
    expect(
      entryMeta({
        decorator: 'Action',
        trigger: { kind: 'text', value: 'order_confirm' },
        scene: '',
        updateClass: 'OrdersUpdate',
        triggerText: "'order_confirm'",
      }),
    ).toEqual({
      decorator: 'Action',
      trigger: "'order_confirm'",
      callbackData: 'order_confirm',
      updateClass: 'OrdersUpdate',
    });

    expect(
      entryMeta({
        decorator: 'Action',
        trigger: { kind: 'regex', source: '^order_(\\d+)$', flags: 'i' },
        scene: '',
        updateClass: 'OrdersUpdate',
      }).callbackData,
    ).toEqual({ regex: '^order_(\\d+)$', flags: 'i' });
  });

  it('records the update type of an event and the scene it sits in', () => {
    expect(
      entryMeta({
        decorator: 'On',
        trigger: { kind: 'text', value: 'text' },
        scene: 'checkout',
        updateClass: 'CheckoutScene',
      }),
    ).toEqual({
      decorator: 'On',
      updateType: 'text',
      scene: 'checkout',
      updateClass: 'CheckoutScene',
    });
  });

  it('says a marked entry is only known from its marker, and claims no callback data', () => {
    expect(
      entryMeta({
        decorator: 'Action',
        trigger: { kind: 'text', value: 'checkout' },
        scene: '',
        updateClass: 'OrdersUpdate',
        triggerText: 'dynamicKey()',
        marker: true,
      }),
    ).toEqual({
      decorator: 'Action',
      trigger: 'dynamicKey()',
      updateClass: 'OrdersUpdate',
      confidence: 'marker',
    });
  });
});

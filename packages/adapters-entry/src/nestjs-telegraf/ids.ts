import type { EntryKind } from '@flowatlas/core';
import type { BotTrigger } from './triggers.js';

/**
 * Decorator to entry kind.
 *
 * `@Hears` produces a command rather than an event because a reply-keyboard
 * button sends plain text that the person pressing it reads as a command;
 * `bot_event` is kept for `@On`, where the trigger is the update type and not
 * what the user meant (D2).
 */
export const BOT_KINDS = {
  Start: 'bot_command',
  Help: 'bot_command',
  Command: 'bot_command',
  Hears: 'bot_command',
  Action: 'bot_callback',
  On: 'bot_event',
  SceneEnter: 'scene_step',
  SceneLeave: 'scene_step',
  WizardStep: 'scene_step',
} as const satisfies Record<string, EntryKind>;

export type BotDecorator = keyof typeof BOT_KINDS;

export const BOT_DECORATORS = Object.keys(BOT_KINDS).sort() as readonly BotDecorator[];

/** Decorators that take no argument: the decorator itself is the command. */
const IMPLIED_COMMAND: Partial<Record<BotDecorator, string>> = { Start: 'start', Help: 'help' };

/** `meta.callbackData` — what the pressed button sends back. */
export type CallbackData = string | { regex: string; flags: string };

/**
 * What a bot entry records beyond the fields every entry node has.
 *
 * Written down as a type because the renderers of later phases read these keys
 * off the node instead of reading the source again.
 */
export type BotEntryMeta = {
  /** The name the framework exports the decorator under, alias or not. */
  decorator: BotDecorator;
  /** The argument exactly as written at the registration site. */
  trigger?: string;
  callbackData?: CallbackData;
  updateType?: string;
  /** Scene or wizard id, on every entry declared inside one. */
  scene?: string;
  /** Step number, on an entry that came from a numbered wizard step. */
  step?: number;
  updateClass: string;
  /** Set only when `@FlowEntry` is what made the entry knowable (I10). */
  confidence?: 'marker';
};

/**
 * A command name means the same registration with or without its slash, so the
 * slash is dropped. Text a `@Hears` matches is kept exactly as written: it is
 * what the person typed, not a command name.
 */
const textKey = (decorator: BotDecorator, value: string): string =>
  decorator === 'Command' ? value.replace(/^\//, '') : value;

/**
 * The kind-specific half of an entry id.
 *
 * A step of a scene is keyed by the scene and the step; everything else by what
 * the user's action carries. Handlers declared inside a scene are prefixed with
 * it because two scenes commonly both answer `@On('text')`, and without the
 * prefix one of the two would be dropped as a duplicate id (D5).
 */
export const deriveKey = (decorator: BotDecorator, trigger: BotTrigger, scene = ''): string => {
  if (BOT_KINDS[decorator] === 'scene_step') {
    if (trigger.kind === 'step') return `${scene}#${trigger.index}`;
    return `${scene}#${decorator === 'SceneLeave' ? 'leave' : 'enter'}`;
  }
  const key =
    trigger.kind === 'regex'
      ? `/${trigger.source}/${trigger.flags}`
      : trigger.kind === 'text'
        ? textKey(decorator, trigger.value)
        : (IMPLIED_COMMAND[decorator] ?? decorator.toLowerCase());
  return scene === '' ? key : `${scene}/${key}`;
};

const callbackDataOf = (trigger: BotTrigger): CallbackData | undefined => {
  if (trigger.kind === 'text') return trigger.value;
  if (trigger.kind === 'regex') return { regex: trigger.source, flags: trigger.flags };
  return undefined;
};

export interface EntryMetaInput {
  decorator: BotDecorator;
  trigger: BotTrigger;
  /** Scene or wizard the handler sits in, empty when it sits in none. */
  scene: string;
  updateClass: string;
  /** The argument as written, when the decorator took one. */
  triggerText?: string;
  /** True when the trigger was only readable from `@FlowEntry`. */
  marker?: boolean;
}

export const entryMeta = (input: EntryMetaInput): BotEntryMeta => {
  const kind = BOT_KINDS[input.decorator];
  // A marked entry is named by its marker, not by what the button carries, so
  // recording the name as callback data would state a run-time fact nobody read.
  const callbackData =
    kind === 'bot_callback' && input.marker !== true ? callbackDataOf(input.trigger) : undefined;
  return {
    decorator: input.decorator,
    ...(input.triggerText === undefined ? {} : { trigger: input.triggerText }),
    ...(callbackData === undefined ? {} : { callbackData }),
    ...(kind === 'bot_event' && input.trigger.kind === 'text'
      ? { updateType: input.trigger.value }
      : {}),
    ...(input.scene === '' ? {} : { scene: input.scene }),
    ...(input.trigger.kind === 'step' ? { step: input.trigger.index } : {}),
    updateClass: input.updateClass,
    ...(input.marker === true ? { confidence: 'marker' as const } : {}),
  };
};

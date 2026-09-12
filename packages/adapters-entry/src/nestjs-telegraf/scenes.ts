import { decoratorArgs } from '@flowatlas/core';
import type { ClassDeclaration } from 'ts-morph';
import { findTelegrafDecorator } from './triggers.js';

/** Class decorators that make a class part of the bot. */
const SCENE_CLASS = ['Scene', 'Wizard'] as const;
const UPDATE_CLASS = ['Update'] as const;

/**
 * How a class takes part in the bot.
 *
 * A scene whose id cannot be read is its own case: every handler inside it
 * would need that id as a prefix, so the class is reported once rather than
 * producing a set of entries keyed on a hole (I3).
 */
export type BotClass =
  | { readonly role: 'update' }
  | { readonly role: 'scene'; readonly decorator: string; readonly scene: string }
  | { readonly role: 'unnamed-scene'; readonly decorator: string; readonly text: string };

export const readBotClass = (declaration: ClassDeclaration): BotClass | undefined => {
  const scene = findTelegrafDecorator(declaration, SCENE_CLASS);
  if (scene !== undefined) {
    const [id] = decoratorArgs(scene.decorator);
    if (id !== undefined && id.resolved && typeof id.value === 'string') {
      return { role: 'scene', decorator: scene.name, scene: id.value };
    }
    return {
      role: 'unnamed-scene',
      decorator: scene.name,
      text: id === undefined ? '' : id.resolved ? String(id.value) : id.text,
    };
  }
  return findTelegrafDecorator(declaration, UPDATE_CLASS) === undefined
    ? undefined
    : { role: 'update' };
};

/** One `@WizardStep` site, as much of it as the chain needs to know. */
export interface StepSite {
  /** The number written in the decorator. */
  index: number;
  /** Entry id of the step, which is what the chain runs between. */
  id: string;
  file: string;
  line: number;
  symbol: string;
}

export interface ChainLink {
  from: string;
  to: string;
  /** The index of the step the link leaves, so a reader sees the wizard's own numbering. */
  order: number;
  /** Line of that step, so the link points at a place in the source. */
  line: number;
}

export interface WizardChain<T> {
  /** The steps to emit, one per index. */
  steps: T[];
  edges: ChainLink[];
  /** Steps left out because their index was already taken. */
  conflicts: T[];
}

/**
 * Orders the steps of one wizard and links each to the next.
 *
 * Gaps in the numbering are the author's business, not an error: the chain runs
 * over the indices that exist, in order. A repeated index is an error, though,
 * because the two handlers would share an id and one of them would vanish; the
 * first one written wins and the other is reported.
 */
export const wizardChain = <T extends StepSite>(steps: readonly T[]): WizardChain<T> => {
  const kept = new Map<number, T>();
  const conflicts: T[] = [];
  for (const step of steps) {
    if (kept.has(step.index)) conflicts.push(step);
    else kept.set(step.index, step);
  }

  const ordered = [...kept.values()].sort((a, b) => a.index - b.index);
  const edges: ChainLink[] = [];
  ordered.forEach((step, position) => {
    const next = ordered[position + 1];
    if (next !== undefined) {
      edges.push({ from: step.id, to: next.id, order: step.index, line: step.line });
    }
  });
  return { steps: ordered, edges, conflicts };
};

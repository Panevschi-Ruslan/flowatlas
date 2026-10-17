/**
 * One node of the graph, written as Markdown an assistant can act on.
 *
 * The renderer is core's (P97): the page's "Copy as prompt" writes with the
 * same one, so the same subject is the same text from either. What is left
 * here are the names this package has always exported.
 */
import { PROMPT_LIMITS as LIMITS, renderPrompt, type PromptLimits, type PromptSubject } from '@flowatlas/core';

export type { PromptGap, PromptLimits, PromptStep, PromptSubject } from '@flowatlas/core';

export const PROMPT_LIMITS: Readonly<PromptLimits> = LIMITS;

/** The Markdown for one subject, bounded: core's `renderPrompt`. */
export const describeForPrompt = (subject: PromptSubject, limits: Partial<PromptLimits> = PROMPT_LIMITS): string =>
  renderPrompt(subject, limits);

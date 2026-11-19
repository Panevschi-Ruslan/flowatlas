import { piped } from 'remeda';
import { getJson } from './http';

/** Reads an address and swallows a failure: Remeda's data-last pipe, `getJson` called first. */
export const loadQuietly = piped(getJson, (answer: Promise<unknown>) => answer.catch(() => undefined));

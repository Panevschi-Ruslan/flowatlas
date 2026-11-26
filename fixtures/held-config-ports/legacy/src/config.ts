import path from 'path';
import { mergeConfig } from './merge';

let current: any;
const defaultsPath = path.join(__dirname, 'settings-defaults');

/** The defaults are loaded lazily, by a path worked out where the code runs. */
async function loadDefaults() {
  return (await import(defaultsPath)).defaults;
}

export async function setConfig(given: Record<string, any>) {
  if (!current) current = await loadDefaults();
  current = mergeConfig(current, given);
}

export function getConfig() {
  return current;
}

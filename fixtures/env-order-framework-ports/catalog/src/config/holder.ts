import path from 'path';
import { mergeConfig } from './merge';

let active: any = require(path.join(__dirname, 'defaults')).defaults;
const ready = Promise.resolve();

/** Lays what it is handed over the defaults once the holder is ready. */
export function setConfig(given: Record<string, any>) {
  return ready.then(() => {
    active = mergeConfig(active, given);
  });
}

export function getConfig() {
  return active;
}

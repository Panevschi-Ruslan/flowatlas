import type { Node as TsNode } from 'ts-morph';
import {
  rootSettingAddress,
  type RootSettingOptions,
  type SettingAddress,
} from '@flowatlas/core';
import { readConfig } from './config.js';

export {
  deref,
  forwardedFrom,
  isReadable,
  parameterBehind,
  splitAtParameter as splitAtParameterIn,
} from '@flowatlas/core';
export type { ForwardedCall, SplitAddress } from '@flowatlas/core';

/**
 * How a service in this ecosystem reads a setting.
 *
 * The core follows a value back to wherever it was decided; recognising a
 * settings read is the one part that knows about a library, so it stays here.
 */
export const settingReader: RootSettingOptions = {
  readSetting: (node: TsNode): string | null => {
    const found = readConfig(node);
    return found !== null && found.dynamic !== true ? found.key : null;
  },
  settingDefault: (node: TsNode): string | undefined => {
    const found = readConfig(node);
    return typeof found?.defaultValue === 'string' && found.defaultValue !== '' ? found.defaultValue : undefined;
  },
};

/** The settings key a string value is rooted at, with what the code falls back to where it writes one (P77). */
export const rootConfigAddress = (value: TsNode): SettingAddress | null => rootSettingAddress(value, settingReader);

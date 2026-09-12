import type { Node as TsNode } from 'ts-morph';
import { rootSettingKey as rootSettingKeyIn, type RootSettingOptions } from '@flowatlas/core';
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
};

/** Follows a string value back to the settings key it is rooted at. */
export const rootConfigKey = (value: TsNode, budget?: number): string | null =>
  rootSettingKeyIn(value, budget === undefined ? settingReader : { ...settingReader, budget });

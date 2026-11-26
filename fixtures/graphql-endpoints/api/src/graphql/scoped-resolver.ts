import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Resolver } from '@nestjs/graphql';

import { SCHEMA_SCOPE } from './api-path';

type Scope = 'store' | 'settings';

/** A resolver of the storefront's schema. */
export const StoreResolver = (of?: () => unknown) =>
  applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata(SCHEMA_SCOPE, 'store' as Scope));

/** A resolver of the settings schema. */
export const SettingsResolver = (of?: () => unknown) =>
  applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata(SCHEMA_SCOPE, 'settings' as Scope));

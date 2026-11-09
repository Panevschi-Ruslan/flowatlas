import { applyDecorators, SetMetadata } from '@nestjs/common';
import { Resolver } from '@nestjs/graphql';

export const SCHEMA_SCOPE = 'SCHEMA_SCOPE';

/** A resolver of the storefront's schema. A resolver with no scope is the settings schema's, by the library's patch. */
export const StoreResolver = (of?: () => unknown) => applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata(SCHEMA_SCOPE, 'store'));

/** A resolver of the settings schema, said outright. */
export const SettingsResolver = (of?: () => unknown) => applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata(SCHEMA_SCOPE, 'settings'));

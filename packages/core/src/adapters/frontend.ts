import type { ExtractContext, PackageJson } from './context.js';

/** What a caller may ask of any frontend extractor, whichever one it is. */
export interface FrontendExtractOptions {
  /** Skip type collection entirely, leaving the registry empty. */
  noTypes?: boolean;
  /** How deep anonymous shapes are written out, overriding the configuration. */
  typesDepth?: number;
}

/**
 * A user-interface extractor.
 *
 * `extract` fills the shared builder from the context, exactly as the other
 * slots do, so a repository is read through the registry rather than through a
 * path of its own. Anything the extractor needs beyond the context is framework
 * knowledge and lives inside it.
 */
export interface FrontendAdapter {
  name: string;
  detect(pkg: PackageJson): boolean;
  extract(ctx: ExtractContext, options?: FrontendExtractOptions): void;
}

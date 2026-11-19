import type { ExtractContext } from './context.js';
import type { PackageJson } from './manifest.js';
import type { ConventionsOf } from '../conventions.js';
import type { ListenPort } from '../listen-port.js';
import type { ProxyReading } from '../proxy-rule.js';

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
  /** What the framework's build would have written for the compiler (P240), when it writes anything. */
  conventions?: ConventionsOf;
  /**
   * The ports the front end's own development or preview server listens on,
   * where the repository writes them (P254): its bundler's configuration, a
   * script's `--port`. Asked beside the entry adapters' (`listeningOf`).
   */
  listens?(ctx: ExtractContext): readonly ListenPort[];
  /**
   * The paths the front end's dev server forwards to another server (P257):
   * its bundler's proxy, a proxy configuration file the dev server is started
   * with. Asked beside the entry adapters' (`proxiesOf`).
   */
  proxies?(ctx: ExtractContext): ProxyReading;
}

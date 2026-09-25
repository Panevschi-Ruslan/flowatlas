import { silentLogger, type FlowatlasConfig, type RepoGraph, type ServiceConfig } from '@flowatlas/core';
import {
  dependentsOf,
  extractRepoFull,
  extractRepoIncremental,
  globalFiles,
  importsOf,
  openRepo,
  repoFiles,
  type WarmRepo,
} from '@flowatlas/extractor-nestjs';
import { createRegistry, EXTRA_PASSES, SERVER_TYPES } from './extractor.js';
import type { IncrementalExtractor, PartialExtract } from './incremental.js';

export interface OpenOptions {
  service: ServiceConfig;
  repoDir: string;
  config: FlowatlasConfig;
}

/**
 * An extractor the command line can keep warm.
 *
 * The four members of {@link IncrementalExtractor} are the contract an
 * extractor must satisfy to take part in incremental rebuilds. The three added
 * here are what the build cache needs from a repository that is already open,
 * and cost nothing once it is.
 */
interface WarmExtractor<Ctx> extends IncrementalExtractor<Ctx> {
  open(options: OpenOptions): Ctx;
  files(ctx: Ctx): string[];
  imports(ctx: Ctx): Record<string, string[]>;
}

const nestjs: WarmExtractor<WarmRepo> = {
  open: ({ service, repoDir, config }) =>
    openRepo({
      rootDir: repoDir,
      repo: service.name,
      service,
      config,
      registry: createRegistry(),
      extraPasses: EXTRA_PASSES,
      logger: silentLogger,
    }),
  files: repoFiles,
  imports: importsOf,
  extractFull: extractRepoFull,
  extractFiles: (repo, files) => extractRepoIncremental(repo, { files }),
  dependentsOf,
  globalFiles,
};

/** One repository, parsed once and read many times. */
export interface ServiceSession {
  readonly name: string;
  readonly repoDir: string;
  files(): string[];
  imports(): Record<string, string[]>;
  globalFiles(): string[];
  dependentsOf(files: readonly string[]): string[];
  extractFull(): Promise<RepoGraph>;
  extractFiles(files: readonly string[]): Promise<PartialExtract>;
}

/** Binds an extractor to one repository, hiding whatever it holds open. */
const sessionOf = <Ctx>(extractor: WarmExtractor<Ctx>, options: OpenOptions): ServiceSession => {
  const ctx = extractor.open(options);
  return {
    name: options.service.name,
    repoDir: options.repoDir,
    files: () => extractor.files(ctx),
    imports: () => extractor.imports(ctx),
    globalFiles: () => extractor.globalFiles(ctx),
    dependentsOf: (files) => extractor.dependentsOf(ctx, files),
    extractFull: () => extractor.extractFull(ctx),
    extractFiles: (files) => extractor.extractFiles(ctx, files),
  };
};

/**
 * Repository types that can be rebuilt without being parsed again.
 *
 * Every type the TypeScript server reader handles, because what is held open is
 * the parsed project and that is the same whichever framework declares the
 * routes in it.
 */
const OPENERS: Record<string, (options: OpenOptions) => ServiceSession> = Object.fromEntries(
  SERVER_TYPES.map((type) => [type, (options: OpenOptions) => sessionOf(nestjs, options)]),
);

export const isIncremental = (type: string): boolean => OPENERS[type] !== undefined;

/**
 * Opens a repository and holds it open.
 *
 * Returns nothing for a repository no extractor can keep warm, which is how a
 * watch falls back to reading it in a process of its own.
 */
export const openSession = (options: OpenOptions): ServiceSession | undefined =>
  OPENERS[options.service.type]?.(options);

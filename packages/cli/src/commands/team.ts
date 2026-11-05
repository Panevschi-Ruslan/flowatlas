import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import type { Command } from 'commander';
import { cannotRun } from '../exit.js';
import { processIo, type QueryIo } from '../query/answer.js';
import { BUNDLE_FILE, BundleError, installBundle, openBundle, packBundle, pulledSource, type BundleManifest } from '../team/bundle.js';
import { fetchBundle, type FetchOptions } from '../team/fetch.js';

/**
 * One graph for the team (P236): `publish` in CI writes the bundle of the graph
 * just built, and `pull` anywhere installs it, so a person with one checkout
 * - or none - asks the whole project. The tool never uploads anything: where
 * the file goes is the workflow's choice, and `pull` reads only the source the
 * configuration or the command names.
 */
export interface PublishOptions {
  config?: string;
  output?: string;
}

export const runPublish = (options: PublishOptions, io: QueryIo = processIo): { path: string; manifest: BundleManifest } => {
  const loaded = loadConfig(options.config ?? process.cwd());
  let packed: ReturnType<typeof packBundle>;
  try {
    packed = packBundle(loaded, loaded.outputDir);
  } catch (cause) {
    throw cannotRun(cause instanceof Error ? cause.message : String(cause));
  }
  const path = resolve(options.output ?? resolve(loaded.outputDir, BUNDLE_FILE));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, packed.archive);
  const commits = packed.manifest.services.map((service) => `${service.name}@${service.commit === null ? 'no commit' : service.commit.slice(0, 7)}`);
  io.err(`wrote ${path} (${Math.round(packed.archive.length / 1024)} KB): ${commits.join(', ')}\n`);
  io.out(`${path}\n`);
  return { path, manifest: packed.manifest };
};

export interface PullOptions {
  config?: string;
  /** Pull even when the source says nothing changed. */
  force?: boolean;
}

export interface PullRun {
  state: 'installed' | 'unchanged';
  from: string;
  manifest?: BundleManifest;
}

/** Fetches, checks and installs the team's graph from `source`, or the configuration's `remote`. */
export const runPull = async (source: string | undefined, options: PullOptions, io: QueryIo = processIo, fetchOptions: FetchOptions = {}): Promise<PullRun> => {
  const loaded = loadConfig(options.config ?? process.cwd());
  const from = source ?? loaded.config.remote?.url;
  if (from === undefined) throw cannotRun('nothing to pull from: name a source, or set remote.url in the configuration');
  const tokenEnv = loaded.config.remote?.tokenEnv;
  const token = fetchOptions.token ?? (tokenEnv === undefined ? undefined : process.env[tokenEnv]);
  const last = pulledSource(loaded.outputDir);
  const etag = options.force === true || last?.source !== from ? undefined : last.etag;
  let fetched: Awaited<ReturnType<typeof fetchBundle>>;
  try {
    fetched = await fetchBundle(from, { ...fetchOptions, ...(token === undefined ? {} : { token }), ...(etag === undefined ? {} : { etag }) }, loaded.rootDir);
  } catch (cause) {
    // Never the token: only what the source answered.
    throw cannotRun(`could not pull ${from}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  // A file has no ETag: its checksum says whether it is the one pulled last.
  if (fetched.archive !== undefined && fetched.etag === undefined) {
    const sum = createHash('sha256').update(fetched.archive).digest('hex');
    const { archive, ...rest } = fetched;
    fetched = etag === sum ? { ...rest, etag: sum } : { ...rest, archive, etag: sum };
  }
  if (fetched.archive === undefined) {
    io.err(`the team's graph is unchanged since ${last?.pulledAt ?? 'the last pull'} (${fetched.from})\n`);
    return { state: 'unchanged', from: fetched.from };
  }
  let bundle;
  try {
    bundle = openBundle(fetched.archive);
  } catch (cause) {
    throw cannotRun(cause instanceof BundleError ? cause.message : `could not read ${fetched.from}: ${String(cause)}`);
  }
  const repoDirs = new Map(loaded.config.services.map((service) => [service.name, loaded.repoDir(service)]));
  installBundle(loaded.outputDir, bundle, { source: from, ...(fetched.etag === undefined ? {} : { etag: fetched.etag }) }, (name) => repoDirs.get(name));
  const commits = bundle.manifest.services.map((service) => `${service.name}@${service.commit === null ? 'no commit' : service.commit.slice(0, 7)}`);
  io.err(`pulled the team's graph, built ${bundle.manifest.builtAt} by flowatlas ${bundle.manifest.flowatlasVersion}: ${commits.join(', ')}\n`);
  return { state: 'installed', from: fetched.from, manifest: bundle.manifest };
};

export const registerTeam = (program: Command): void => {
  program
    .command('publish')
    .description("write the graph just built as one file, for the team to pull (the workflow decides where it goes)")
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--output <file>', `where to write it (default: <output>/${BUNDLE_FILE})`)
    .action((options: PublishOptions) => {
      runPublish(options);
    });
  program
    .command('pull')
    .argument('[source]', 'gh:owner/repo/artifact-name, an https address, or a file (default: remote.url in the configuration)')
    .description("install the team's graph, so the whole project can be asked without checking it all out")
    .option('--config <path>', 'configuration file (default: found from the working directory)')
    .option('--force', 'pull even when the source says nothing changed')
    .action(async (source: string | undefined, options: PullOptions) => {
      await runPull(source, options);
    });
};

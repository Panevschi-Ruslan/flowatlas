import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  FRESHNESS_FILE,
  OBSERVED_FILE,
  readFreshness,
  SCHEMA_VERSION,
  serviceOutputDir,
  type Freshness,
  type LoadedConfig,
} from '@flowatlas/core';
import { DOCS_FILE, openGraphDb } from '@flowatlas/linker';
import { NAMES_FILE } from '../agents/names.js';
import { hashConfig } from '../build/cache.js';
import { VERSION } from '../version.js';
import { readTarGz, writeTarGz, type ArchiveFile } from './archive.js';

/**
 * A team's graph as one file (P236): what CI builds on the main branch, for
 * anybody to `flowatlas pull` and ask without checking out every repository.
 *
 * It holds the graph and what the tools read beside it - each service's own
 * graph, which an overlay needs, the docs index, the name index, what was
 * observed, and each service's checkout - with a manifest and the checksum of
 * every file. Never a line of source: the graph says where everything is, and
 * a checkout is how to read it.
 */
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_FILE = 'flowatlas-graph.tgz';
export const MANIFEST_FILE = 'manifest.json';
export const SUMS_FILE = 'SHA256SUMS';
export { PULLED_DIR } from '@flowatlas/mcp';
import { PULLED_DIR } from '@flowatlas/mcp';
/** What `pull` remembers of where a bundle came from, beside it. */
export const SOURCE_FILE = 'source.json';

export interface BundleManifest {
  bundleFormatVersion: number;
  flowatlasVersion: string;
  schemaVersion: number;
  builtAt: string;
  configHash: string;
  services: Array<{ name: string; commit: string | null; branch: string | null; dirty: boolean }>;
}

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** The files beside the graph a pulled graph is asked with, where a build wrote them. */
const BESIDE = ['project-graph.json', 'link-report.json', DOCS_FILE, FRESHNESS_FILE, NAMES_FILE, OBSERVED_FILE];

/** The database whole, write-ahead log folded in: a copy of the file alone can miss its last writes. */
const databaseCopy = (dbPath: string, scratch: string): Buffer => {
  const copy = join(scratch, 'graph.db');
  rmSync(copy, { force: true });
  const db = openGraphDb(dbPath);
  try {
    db.copyTo(copy);
  } finally {
    db.close();
  }
  const data = readFileSync(copy);
  rmSync(copy, { force: true });
  return data;
};

/** The bundle of the graph a build wrote for `loaded`, as bytes, and its manifest. */
export const packBundle = (loaded: LoadedConfig, outputDir: string): { archive: Buffer; manifest: BundleManifest } => {
  const dbPath = join(outputDir, 'graph.db');
  if (!existsSync(dbPath)) throw new Error(`no graph at ${dbPath}: run flowatlas build first`);
  const freshness: Freshness | undefined = readFreshness(dbPath);
  const report = JSON.parse(readFileSync(join(outputDir, 'link-report.json'), 'utf8')) as { builtAt?: string };
  const scratch = join(outputDir, '.publish');
  mkdirSync(scratch, { recursive: true });
  const files: ArchiveFile[] = [];
  try {
    files.push({ name: 'graph.db', data: databaseCopy(dbPath, scratch) });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const name of BESIDE) {
    const path = join(outputDir, name);
    if (existsSync(path)) files.push({ name, data: readFileSync(path) });
  }
  for (const service of loaded.config.services) {
    const path = join(serviceOutputDir(outputDir, service.name), 'graph.json');
    if (existsSync(path)) files.push({ name: `services/${service.name.replace(/[^\w.-]/g, '_')}.graph.json`, data: readFileSync(path) });
  }
  const manifest: BundleManifest = {
    bundleFormatVersion: BUNDLE_FORMAT_VERSION,
    flowatlasVersion: VERSION,
    schemaVersion: SCHEMA_VERSION,
    builtAt: report.builtAt ?? freshness?.builtAt ?? new Date().toISOString(),
    configHash: hashConfig(loaded.config),
    services: loaded.config.services.map((service) => {
      const checkout = freshness?.services[service.name];
      return { name: service.name, commit: checkout?.commit ?? null, branch: checkout?.branch ?? null, dirty: checkout?.dirty ?? false };
    }),
  };
  files.push({ name: MANIFEST_FILE, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  const sums = files.map((file) => `${sha256(file.data)}  ${file.name}`).join('\n');
  files.push({ name: SUMS_FILE, data: Buffer.from(`${sums}\n`) });
  return { archive: writeTarGz(files), manifest };
};

/** Why a bundle was refused; nothing has been written when one is thrown. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

/**
 * A bundle read and checked, before anything is installed (D2): every file
 * against its checksum, the manifest against what this version can read.
 */
export const openBundle = (archive: Buffer): { files: ArchiveFile[]; manifest: BundleManifest } => {
  let files: ArchiveFile[];
  try {
    files = readTarGz(archive);
  } catch (cause) {
    throw new BundleError(`not a flowatlas bundle: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const sums = files.find((file) => file.name === SUMS_FILE);
  if (sums === undefined) throw new BundleError(`not a flowatlas bundle: it has no ${SUMS_FILE}`);
  const expected = new Map(
    sums.data
      .toString('utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const [hash, ...name] = line.split('  ');
        return [name.join('  '), hash] as const;
      }),
  );
  for (const file of files) {
    if (file.name === SUMS_FILE) continue;
    const want = expected.get(file.name);
    if (want === undefined || want !== sha256(file.data)) throw new BundleError(`the bundle is damaged: ${file.name} does not match its checksum`);
  }
  for (const name of expected.keys()) if (!files.some((file) => file.name === name)) throw new BundleError(`the bundle is damaged: ${name} is missing`);
  const manifestFile = files.find((file) => file.name === MANIFEST_FILE);
  if (manifestFile === undefined) throw new BundleError(`not a flowatlas bundle: it has no ${MANIFEST_FILE}`);
  const manifest = JSON.parse(manifestFile.data.toString('utf8')) as BundleManifest;
  if (manifest.bundleFormatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new BundleError(`a bundle of format ${manifest.bundleFormatVersion}, which flowatlas ${VERSION} does not read (it reads ${BUNDLE_FORMAT_VERSION})`);
  }
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new BundleError(
      `a graph of schema ${manifest.schemaVersion}, built by flowatlas ${manifest.flowatlasVersion}; this is ${VERSION} (schema ${SCHEMA_VERSION}): npm install -g @flowatlas/cli@${manifest.flowatlasVersion}`,
    );
  }
  return { files, manifest };
};

export interface PulledSource {
  source: string;
  etag?: string;
  pulledAt: string;
  manifest: BundleManifest;
}

/**
 * Installs a checked bundle into `<output>/pulled/`, written whole into a
 * directory beside it and moved into place, so no question is ever asked of
 * half a graph (D2). Its freshness names this machine's directories, so a
 * checkout here is compared with the commit CI built.
 */
export const installBundle = (
  outputDir: string,
  bundle: { files: ArchiveFile[]; manifest: BundleManifest },
  source: Omit<PulledSource, 'manifest' | 'pulledAt'>,
  dirOf: (service: string) => string | undefined,
): string => {
  const target = join(outputDir, PULLED_DIR);
  const staging = `${target}.incoming`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'services'), { recursive: true });
  for (const file of bundle.files) {
    if (file.name.includes('..') || file.name.startsWith('/')) throw new BundleError(`the bundle names a path outside itself: ${file.name}`);
    const path = join(staging, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.data);
  }
  const freshnessPath = join(staging, FRESHNESS_FILE);
  if (existsSync(freshnessPath)) {
    const freshness = JSON.parse(readFileSync(freshnessPath, 'utf8')) as Freshness;
    for (const [name, service] of Object.entries(freshness.services)) {
      const here = dirOf(name);
      if (here !== undefined) service.dir = here;
    }
    writeFileSync(freshnessPath, `${JSON.stringify(freshness)}\n`);
  }
  const record: PulledSource = { ...source, pulledAt: new Date().toISOString(), manifest: bundle.manifest };
  writeFileSync(join(staging, SOURCE_FILE), `${JSON.stringify(record, null, 2)}\n`);
  const old = `${target}.previous`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(target)) renameSync(target, old);
  renameSync(staging, target);
  rmSync(old, { recursive: true, force: true });
  return target;
};

/** What `pull` last installed, or undefined. */
export const pulledSource = (outputDir: string): PulledSource | undefined => {
  try {
    return JSON.parse(readFileSync(join(outputDir, PULLED_DIR, SOURCE_FILE), 'utf8')) as PulledSource;
  } catch {
    return undefined;
  }
};

/** A pulled service's own graph, for an overlay; undefined when the bundle has none for it. */
export const pulledServiceGraphPath = (outputDir: string, service: string): string =>
  join(outputDir, PULLED_DIR, 'services', `${service.replace(/[^\w.-]/g, '_')}.graph.json`);

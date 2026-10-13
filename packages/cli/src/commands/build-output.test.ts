import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { listRepoSources, serviceDirectoryName, serviceOutputDir } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import { isIgnored, watchProject } from '../build/watch.js';
import {
  buildJson,
  buildProject,
  leftoverRepoOutputs,
  leftoversLine,
  serviceGraphPath,
  summariseBuild,
} from './build.js';

/**
 * Where a build writes, and where it does not (R166).
 *
 * A build used to write each service's graph and file hashes into the service's
 * repository. Pointed at somebody else's checkouts for a read-only look, it left
 * an untracked `.flowatlas/` in every one of them, and two projects naming the
 * same repository shared, and overwrote, one set of those files. Everything a
 * build writes now goes under the output directory the configuration names.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXED = '2026-01-01T00:00:00.000Z';

/** Beside the fixtures, so a copy still resolves the type stubs hoisted there. */
const scratch = mkdtempSync(join(FIXTURES, '.scratch-output-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A fresh copy of a fixture, without whatever an earlier run left in it. */
const copyOf = (fixture: string, as = fixture): string => {
  const dir = join(scratch, as);
  cpSync(join(FIXTURES, fixture), dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  return dir;
};

/**
 * Every file and directory under `dir`, with what it holds.
 *
 * Content and modification time both: a file rewritten with the same bytes is
 * still a write into somebody's repository.
 */
const snapshot = (dir: string): Map<string, string> => {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      const key = relative(dir, path);
      if (entry.isDirectory()) {
        out.set(key, 'dir');
        walk(path);
        continue;
      }
      const stat = statSync(path);
      const hash = createHash('sha1').update(readFileSync(path)).digest('hex');
      out.set(key, `${stat.size}:${stat.mtimeMs}:${hash}`);
    }
  };
  walk(dir);
  return out;
};

/** What changed between two snapshots, as paths. */
const changed = (before: Map<string, string>, after: Map<string, string>): string[] => {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
};

const writeConfig = (dir: string, config: Record<string, unknown>): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'flowatlas.config.json');
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
};

const MULTI_REPO_SERVICES = ['gateway', 'orders', 'billing', 'web'];

describe('a build reads the repositories and writes only to its output', () => {
  it('creates and modifies nothing under any repository, over a full, a cached and a one-service build', async () => {
    const project = copyOf('multi-repo', 'untouched');
    const repos = MULTI_REPO_SERVICES.map((name) => join(project, name));
    const before = new Map(repos.map((repo) => [repo, snapshot(repo)]));

    const full = await buildProject({ config: project, builtAt: FIXED });
    const cached = await buildProject({ config: project, builtAt: FIXED });
    const one = await buildProject({ config: project, builtAt: FIXED, service: ['orders'], cache: false });
    expect(full.failed).toBe(false);
    expect(Object.values(cached.plan).every((entry) => entry.mode === 'skip')).toBe(true);
    expect(one.plan['orders']?.mode).toBe('full');

    for (const repo of repos) {
      expect(changed(before.get(repo) ?? new Map(), snapshot(repo)), repo).toEqual([]);
      expect(existsSync(join(repo, '.flowatlas')), repo).toBe(false);
    }
    expect(full.leftovers).toEqual([]);
  }, 240_000);

  it('gives every service a directory of its own under services/, and nothing else', async () => {
    const project = copyOf('multi-repo', 'per-service');
    const result = await buildProject({ config: project, builtAt: FIXED });

    const services = join(result.outputDir, 'services');
    expect(readdirSync(services).sort()).toEqual([...MULTI_REPO_SERVICES].sort());
    for (const name of MULTI_REPO_SERVICES) {
      const files = readdirSync(serviceOutputDir(result.outputDir, name)).sort();
      // Every reader records file hashes beside its graph, and the installed
      // files its reading used, the browser reader too.
      expect(files, name).toEqual(['cache.json', 'graph.json']);
      const graph = JSON.parse(readFileSync(serviceGraphPath(result.outputDir, name), 'utf8')) as {
        repo: string;
      };
      expect(graph.repo, name).toBe(name);
    }
    // The build cache records the graph where it now is.
    const cache = JSON.parse(readFileSync(result.cachePath, 'utf8')) as {
      repos: Record<string, { graphPath: string }>;
    };
    expect(cache.repos['orders']?.graphPath).toBe(serviceGraphPath(result.outputDir, 'orders'));
  }, 240_000);

  it('follows --out for the service graphs as well as the project ones', async () => {
    const project = copyOf('multi-repo', 'moved-out');
    const out = join(scratch, 'moved-out-elsewhere');
    const result = await buildProject({ config: project, out, builtAt: FIXED });

    expect(result.outputDir).toBe(out);
    expect(existsSync(serviceGraphPath(out, 'gateway'))).toBe(true);
    expect(existsSync(join(project, '.flowatlas'))).toBe(false);

    const again = await buildProject({ config: project, out, builtAt: FIXED, service: ['billing'] });
    expect(again.plan['gateway']).toEqual({ mode: 'skip', reason: 'not selected' });
    expect(JSON.stringify(again.project)).toBe(JSON.stringify(result.project));
  }, 240_000);

  it('keeps two projects that read the same repositories out of each other’s way', async () => {
    const project = copyOf('multi-repo', 'shared');
    const services = MULTI_REPO_SERVICES.filter((name) => name !== 'web').map((name) => ({
      name,
      repo: join(project, name),
      type: 'nestjs',
    }));
    // Two configurations that read the same repositories differently: one
    // knows the shared package, the other does not, so their graphs differ.
    const one = writeConfig(join(scratch, 'shared-one'), {
      services,
      sharedPackages: ['@fx/contracts'],
      output: '.flowatlas',
    });
    const two = writeConfig(join(scratch, 'shared-two'), {
      services,
      sharedPackages: [],
      output: '.flowatlas',
    });

    const first = await buildProject({ config: one, builtAt: FIXED });
    const graphs = new Map(
      services.map(({ name }) => [name, readFileSync(serviceGraphPath(first.outputDir, name), 'utf8')]),
    );
    await buildProject({ config: two, builtAt: FIXED });
    const again = await buildProject({ config: one, builtAt: FIXED });

    // Each project's files are its own: the other project's build rewrote
    // none of them, so the first project's next build is still free.
    for (const [name, graph] of graphs) {
      expect(readFileSync(serviceGraphPath(first.outputDir, name), 'utf8'), name).toBe(graph);
      expect(again.plan[name], name).toEqual({ mode: 'skip', reason: '0 files changed' });
    }
  }, 240_000);

  it('removes the directory of a service the configuration no longer names, and only one that is all its own', async () => {
    const project = copyOf('multi-repo', 'renamed');
    const config = writeConfig(project, {
      ...JSON.parse(readFileSync(join(project, 'flowatlas.config.json'), 'utf8')),
    });
    const first = await buildProject({ config, builtAt: FIXED });
    const kept = join(first.outputDir, 'services', 'someone-elses');
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, 'notes.txt'), 'not the build’s\n');

    const raw = JSON.parse(readFileSync(config, 'utf8')) as { services: { name: string }[] };
    for (const service of raw.services) if (service.name === 'billing') service.name = 'payments';
    writeFileSync(config, JSON.stringify(raw, null, 2));
    const second = await buildProject({ config, builtAt: FIXED });

    expect(existsSync(serviceOutputDir(second.outputDir, 'billing'))).toBe(false);
    expect(existsSync(serviceGraphPath(second.outputDir, 'payments'))).toBe(true);
    expect(existsSync(join(kept, 'notes.txt'))).toBe(true);
  }, 240_000);
});

describe('an output directory inside a repository it reads', () => {
  it('changes nothing in the repository outside the configured output', async () => {
    const repo = copyOf('nest-kafka', 'output-at-root');
    const before = snapshot(repo);

    const result = await buildProject({ config: repo, builtAt: FIXED });
    expect(result.outputDir).toBe(join(repo, '.flowatlas'));
    const moved = changed(before, snapshot(repo));
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.filter((path) => path !== '.flowatlas' && !path.startsWith(`.flowatlas${sep}`))).toEqual([]);
    // The configuration's own output directory is not a leftover of anything.
    expect(result.leftovers).toEqual([]);
  }, 240_000);

  it('never reads the output as source, whatever the output is called', async () => {
    const repo = copyOf('nest-kafka', 'output-not-a-dot');
    const config = writeConfig(repo, {
      ...JSON.parse(readFileSync(join(repo, 'flowatlas.config.json'), 'utf8')),
      output: 'graph-out',
    });
    const before = snapshot(repo);

    const first = await buildProject({ config, builtAt: FIXED });
    expect(first.outputDir).toBe(join(repo, 'graph-out'));
    // What keeps it out is what a source is: a reader opens `.ts` and `.tsx`
    // files, and a build writes neither, wherever its output is.
    expect(listRepoSources(repo).filter((file) => file.startsWith('graph-out/'))).toEqual([]);

    const second = await buildProject({ config, builtAt: FIXED });
    expect(second.plan['nest-kafka']).toEqual({ mode: 'skip', reason: '0 files changed' });
    const moved = changed(before, snapshot(repo));
    expect(moved.filter((path) => path !== 'graph-out' && !path.startsWith(`graph-out${sep}`))).toEqual([]);
  }, 240_000);

  it('is not watched, so a watch does not rebuild for ever on its own writes', async () => {
    const repo = copyOf('nest-kafka', 'watched-output');
    const config = writeConfig(repo, {
      ...JSON.parse(readFileSync(join(repo, 'flowatlas.config.json'), 'utf8')),
      output: 'graph-out',
    });
    let rebuilds = 0;
    const handle = await watchProject({
      config,
      debounceMs: 40,
      print: () => {},
      onRebuild: () => {
        rebuilds += 1;
      },
    });
    const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
    try {
      // The first build runs before anything is watched, so it is a save that
      // shows whether the build's own writes come back as changes.
      const source = join(repo, 'src', readdirSync(join(repo, 'src')).find((name) => name.endsWith('.ts')) ?? '');
      writeFileSync(source, `${readFileSync(source, 'utf8')}\n// saved\n`);
      await pause(2_000);
      await handle.settled();
      const settled = rebuilds;
      await pause(1_500);
      await handle.settled();
      // One rebuild for the save, and at most one more for a save the watcher
      // heard twice; a watch that heard its own writes would still be going.
      expect(rebuilds).toBe(settled);
      expect(settled).toBeGreaterThanOrEqual(2);
      expect(settled).toBeLessThanOrEqual(3);
    } finally {
      await handle.close();
    }
  }, 120_000);
});

describe('which paths a watch leaves alone', () => {
  const repo = join(sep, 'work', 'api');

  it('ignores the output inside a repository whatever it is called', () => {
    const out = join(repo, 'graph-out');
    expect(isIgnored(repo, join(out, 'project-graph.json'), out)).toBe(true);
    expect(isIgnored(repo, join(out, 'services', 'api', 'graph.json'), out)).toBe(true);
    expect(isIgnored(repo, out, out)).toBe(true);
    expect(isIgnored(repo, join(repo, 'src', 'main.ts'), out)).toBe(false);
  });

  it('ignores only what the build writes when the output holds the repository', () => {
    const out = join(sep, 'work');
    expect(isIgnored(repo, join(out, 'project-graph.json'), out)).toBe(true);
    expect(isIgnored(repo, join(out, 'graph.db-wal'), out)).toBe(true);
    expect(isIgnored(repo, join(out, 'services', 'api', 'graph.json'), out)).toBe(true);
    expect(isIgnored(repo, join(repo, 'src', 'main.ts'), out)).toBe(false);
    expect(isIgnored(repo, repo, out)).toBe(false);
    expect(isIgnored(repo, join(repo, 'package.json'), out)).toBe(false);
  });

  it('ignores the output and the repository as one when they are the same directory', () => {
    // `"output": "."` beside `"repo": "."`: the sources and the outputs share a
    // directory, and only the outputs are the build's.
    expect(isIgnored(repo, join(repo, 'project-graph.json'), repo)).toBe(true);
    expect(isIgnored(repo, join(repo, 'services', 'api', 'cache.json'), repo)).toBe(true);
    expect(isIgnored(repo, join(repo, 'tsconfig.json'), repo)).toBe(false);
    expect(isIgnored(repo, join(repo, 'src', 'main.ts'), repo)).toBe(false);
  });
});

describe('what an earlier version left in the repositories', () => {
  /** A repository with a `.flowatlas` holding the named files. */
  const plant = (repo: string, files: readonly string[]): string => {
    const dir = join(repo, '.flowatlas');
    mkdirSync(dir, { recursive: true });
    for (const file of files) writeFileSync(join(dir, file), '{}\n');
    return dir;
  };

  it('names the old per-repository directories once, and deletes none of them', async () => {
    const project = copyOf('multi-repo', 'leftovers');
    const orders = plant(join(project, 'orders'), ['graph.json', 'cache.json']);
    const web = plant(join(project, 'web'), ['graph.json']);
    const billing = plant(join(project, 'billing'), ['cache.json']);
    // Some project's output rather than one service's leftovers.
    plant(join(project, 'gateway'), ['project-graph.json', 'cache.json']);

    const result = await buildProject({ config: project, builtAt: FIXED });
    expect(result.leftovers).toEqual([billing, orders, web]);

    const line = leftoversLine(result.leftovers);
    expect(line).toContain('safe to delete');
    expect(summariseBuild(result)).toContain(line);
    expect(summariseBuild(result).filter((entry) => entry.includes('safe to delete'))).toHaveLength(1);
    expect(buildJson(result).notes).toEqual([line]);

    for (const dir of [orders, web, billing]) {
      expect(existsSync(join(dir, readdirSync(dir)[0] ?? 'missing')), dir).toBe(true);
    }
    expect(readFileSync(join(orders, 'graph.json'), 'utf8')).toBe('{}\n');
  }, 240_000);

  it('says nothing, and prints the report alone, when there is nothing to say', async () => {
    const project = copyOf('multi-repo', 'no-leftovers');
    const result = await buildProject({ config: project, builtAt: FIXED });
    expect(result.leftovers).toEqual([]);
    expect(summariseBuild(result).some((line) => line.includes('safe to delete'))).toBe(false);
    expect(buildJson(result)).toBe(result.report);
  }, 240_000);

  it('does not name a directory that is, or holds, the output', () => {
    const repo = join(scratch, 'holds-output');
    const dir = plant(repo, ['graph.json', 'cache.json']);
    expect(leftoverRepoOutputs([repo], dir)).toEqual([]);
    expect(leftoverRepoOutputs([repo], join(dir, 'nested'))).toEqual([]);
    expect(leftoverRepoOutputs([repo], join(scratch, 'elsewhere'))).toEqual([dir]);
  });

  it('names a directory two services share once', () => {
    const repo = join(scratch, 'two-services-one-repo');
    const dir = plant(repo, ['graph.json']);
    expect(leftoverRepoOutputs([repo, repo], join(scratch, 'elsewhere'))).toEqual([dir]);
  });

  it('does not name a .flowatlas holding nothing a build wrote', () => {
    const repo = join(scratch, 'unrelated-dot-dir');
    plant(repo, ['doctor.json']);
    expect(leftoverRepoOutputs([repo], join(scratch, 'elsewhere'))).toEqual([]);
  });
});

describe('a service name that is not a directory name', () => {
  it('writes a scoped name to one directory beside the others', async () => {
    const project = copyOf('multi-repo', 'scoped');
    const raw = JSON.parse(readFileSync(join(project, 'flowatlas.config.json'), 'utf8')) as {
      services: { name: string }[];
    };
    for (const service of raw.services) if (service.name === 'orders') service.name = '@shop/Orders';
    writeConfig(project, raw);

    const result = await buildProject({ config: project, builtAt: FIXED });
    expect(result.failed).toBe(false);
    expect(readdirSync(join(result.outputDir, 'services'))).toContain(
      serviceDirectoryName('@shop/Orders'),
    );
    expect(existsSync(join(result.outputDir, 'services', '@shop'))).toBe(false);
    expect(existsSync(serviceGraphPath(result.outputDir, '@shop/Orders'))).toBe(true);
  }, 240_000);
});

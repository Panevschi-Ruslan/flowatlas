import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { DbHandle, pulledLine } from '@flowatlas/mcp';
import { afterAll, describe, expect, it } from 'vitest';
import { runPublish, runPull } from '../commands/team.js';
import { CliError, EXIT } from '../exit.js';
import type { QueryIo } from '../query/answer.js';
import { buildTestProject } from '../test-graph.js';
import { readTarGz, readZip, writeTarGz } from './archive.js';
import { openBundle, PULLED_DIR } from './bundle.js';
import { fetchBundle } from './fetch.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-team-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const quiet = (): QueryIo & { said: string } => {
  const io = { said: '', out: () => {}, err: (text: string) => void (io.said += text) };
  return io;
};

/** A zip of stored or deflated entries, as an Actions artifact downloads. */
const zipOf = (files: Array<{ name: string; data: Buffer; deflate?: boolean }>): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const body = file.deflate === true ? deflateRawSync(file.data) : file.data;
    const name = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(file.deflate === true ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(file.deflate === true ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

describe('the archives a team graph travels in (P236)', () => {
  it('writes and reads a gzipped tar, the same bytes for the same files', () => {
    const files = [
      { name: 'graph.db', data: Buffer.from('a'.repeat(1300)) },
      { name: 'services/orders.graph.json', data: Buffer.from('{}') },
    ];
    expect(readTarGz(writeTarGz(files))).toEqual(files);
    expect(writeTarGz(files).equals(writeTarGz(files))).toBe(true);
  });

  it('reads a zip, stored and deflated', () => {
    const zip = zipOf([
      { name: 'flowatlas-graph.tgz', data: Buffer.from('tgz bytes') },
      { name: 'notes.txt', data: Buffer.from('x'.repeat(500)), deflate: true },
    ]);
    expect(readZip(zip).map((file) => [file.name, file.data.length])).toEqual([
      ['flowatlas-graph.tgz', 9],
      ['notes.txt', 500],
    ]);
  });
});

/** A project of three services as CI has them, built, and a laptop with only one checked out. */
const projects = () => {
  const root = mkdtempSync(join(scratch, 'p-'));
  const services = [
    { name: 'gateway', repo: './gateway', type: 'nestjs' },
    { name: 'orders', repo: './orders', type: 'nestjs' },
    { name: 'billing', repo: './billing', type: 'nestjs' },
  ];
  const ci = join(root, 'ci');
  for (const service of services) mkdirSync(join(ci, service.repo), { recursive: true });
  writeFileSync(join(ci, 'flowatlas.config.json'), JSON.stringify({ services }));
  const out = join(ci, '.flowatlas');
  mkdirSync(out, { recursive: true });
  copyFileSync(buildTestProject(`team-${root.slice(-6)}`).dbPath, join(out, 'graph.db'));
  writeFileSync(join(out, 'link-report.json'), JSON.stringify({ builtAt: '2026-11-05T10:00:00.000Z', services: [] }));
  writeFileSync(join(out, 'project-graph.json'), JSON.stringify({ nodes: [], edges: [] }));
  const laptop = join(root, 'laptop');
  mkdirSync(join(laptop, 'gateway'), { recursive: true });
  const bundle = join(out, 'flowatlas-graph.tgz');
  writeFileSync(join(laptop, 'flowatlas.config.json'), JSON.stringify({ services, remote: { url: bundle } }));
  return { ci: join(ci, 'flowatlas.config.json'), laptop: join(laptop, 'flowatlas.config.json'), laptopDir: laptop, bundle };
};

describe('publish in CI, pull on a laptop with one checkout (P236)', () => {
  it('pulls the graph whole, checked, and the questions read it; a second pull with nothing new installs nothing', async () => {
    const { ci, laptop, laptopDir, bundle } = projects();
    const published = runPublish({ config: ci }, quiet());
    expect(published.path).toBe(bundle);
    expect(published.manifest).toMatchObject({ bundleFormatVersion: 1, schemaVersion: expect.any(Number), builtAt: '2026-11-05T10:00:00.000Z' });
    const first = await runPull(undefined, { config: laptop }, quiet());
    expect(first.state).toBe('installed');
    expect(existsSync(join(laptopDir, '.flowatlas', PULLED_DIR, 'graph.db'))).toBe(true);
    // No graph built here: every question reads the team's, and says so.
    const handle = new DbHandle({ configPath: laptop });
    expect(handle.path).toBe(join(laptopDir, '.flowatlas', PULLED_DIR, 'graph.db'));
    expect(pulledLine(handle.path)).toMatch(/^the team's graph, pulled from .*flowatlas-graph\.tgz \d{4}-\d\d-\d\d \d\d:\d\d, built 2026-11-05 10:00$/);
    expect((await runPull(undefined, { config: laptop }, quiet())).state).toBe('unchanged');
  });

  it('carries no source, only the graph and what is read beside it', () => {
    const { ci, bundle } = projects();
    runPublish({ config: ci }, quiet());
    const names = openBundle(readFileSync(bundle)).files.map((file) => file.name).sort();
    expect(names).toEqual(['SHA256SUMS', 'graph.db', 'link-report.json', 'manifest.json', 'project-graph.json']);
  });

  it('refuses a damaged bundle and one from a newer schema, and installs nothing', async () => {
    const { ci, laptop, laptopDir, bundle } = projects();
    runPublish({ config: ci }, quiet());
    const files = readTarGz(readFileSync(bundle));
    const tampered = files.map((file) => (file.name === 'graph.db' ? { ...file, data: Buffer.from('not the graph') } : file));
    writeFileSync(bundle, writeTarGz(tampered));
    const damaged = await runPull(undefined, { config: laptop }, quiet()).catch((error: unknown) => error as CliError);
    expect(damaged).toBeInstanceOf(CliError);
    expect((damaged as CliError).code).toBe(EXIT.cannotRun);
    expect((damaged as CliError).message).toContain('graph.db does not match its checksum');
    expect(existsSync(join(laptopDir, '.flowatlas', PULLED_DIR))).toBe(false);

    const newer = files.map((file) => {
      if (file.name !== 'manifest.json') return file;
      const manifest = JSON.parse(file.data.toString('utf8'));
      return { ...file, data: Buffer.from(JSON.stringify({ ...manifest, schemaVersion: 999, flowatlasVersion: '9.0.0' })) };
    });
    const { createHash } = await import('node:crypto');
    const sums = newer.filter((file) => file.name !== 'SHA256SUMS').map((file) => `${createHash('sha256').update(file.data).digest('hex')}  ${file.name}`).join('\n');
    writeFileSync(bundle, writeTarGz([...newer.filter((file) => file.name !== 'SHA256SUMS'), { name: 'SHA256SUMS', data: Buffer.from(`${sums}\n`) }]));
    const refused = await runPull(undefined, { config: laptop, force: true }, quiet()).catch((error: unknown) => error as CliError);
    expect((refused as CliError).message).toContain('npm install -g @flowatlas/cli@9.0.0');
  });

  it('says what to do when there is nothing to pull from', async () => {
    const { ci } = projects();
    await expect(runPull(undefined, { config: ci }, quiet())).rejects.toThrow(/set remote\.url/);
  });
});

/** A fetch over a few fixed addresses, recording what each request carried. */
const fakeFetch = (routes: Record<string, (headers: Record<string, string>) => { status: number; body?: Buffer | object; headers?: Record<string, string> }>) => {
  const seen: Array<{ url: string; auth: boolean }> = [];
  const impl = (async (url: string, init?: { headers?: Record<string, string> }) => {
    const headers = init?.headers ?? {};
    seen.push({ url, auth: headers['Authorization'] !== undefined });
    const route = routes[url.split('?')[0] as string];
    const answer = route === undefined ? { status: 404 } : route(headers);
    const body = answer.body;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: { get: (name: string) => answer.headers?.[name.toLowerCase()] ?? null },
      json: async () => body,
      arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? null))),
    };
  }) as unknown as typeof fetch;
  return { impl, seen };
};

describe('where a team graph is fetched from', () => {
  it('sends the token to the host it was given for, and never on after a redirect to another', async () => {
    const { impl, seen } = fakeFetch({
      'https://releases.example.test/graph.tgz': () => ({ status: 302, headers: { location: 'https://storage.example.test/signed' } }),
      'https://storage.example.test/signed': () => ({ status: 200, body: Buffer.from('bytes'), headers: { etag: '"v1"' } }),
    });
    const fetched = await fetchBundle('https://releases.example.test/graph.tgz', { token: 'secret', fetchImpl: impl });
    expect(fetched).toMatchObject({ etag: '"v1"' });
    expect(seen).toEqual([
      { url: 'https://releases.example.test/graph.tgz', auth: true },
      { url: 'https://storage.example.test/signed', auth: false },
    ]);
  });

  it('asks again with the ETag it has, and is told nothing changed', async () => {
    const { impl } = fakeFetch({
      'https://releases.example.test/graph.tgz': (headers) => (headers['If-None-Match'] === '"v1"' ? { status: 304 } : { status: 200, body: Buffer.from('x') }),
    });
    expect((await fetchBundle('https://releases.example.test/graph.tgz', { etag: '"v1"', fetchImpl: impl })).archive).toBeUndefined();
  });

  it('refuses plain http to another machine', async () => {
    await expect(fetchBundle('http://example.test/graph.tgz')).rejects.toThrow(/only https/);
  });

  it('takes the newest unexpired artifact from the default branch, out of its zip', async () => {
    const tgz = writeTarGz([{ name: 'x', data: Buffer.from('y') }]);
    const { impl, seen } = fakeFetch({
      'https://api.github.com/repos/acme/shop': () => ({ status: 200, body: { default_branch: 'main' } }),
      'https://api.github.com/repos/acme/shop/actions/artifacts': () => ({
        status: 200,
        body: {
          artifacts: [
            { id: 1, expired: false, created_at: '2026-11-01T00:00:00Z', archive_download_url: 'https://api.github.com/dl/1', workflow_run: { head_branch: 'main' } },
            { id: 2, expired: false, created_at: '2026-11-04T00:00:00Z', archive_download_url: 'https://api.github.com/dl/2', workflow_run: { head_branch: 'main' } },
            { id: 3, expired: false, created_at: '2026-11-05T00:00:00Z', archive_download_url: 'https://api.github.com/dl/3', workflow_run: { head_branch: 'feature' } },
            { id: 4, expired: true, created_at: '2026-11-06T00:00:00Z', archive_download_url: 'https://api.github.com/dl/4', workflow_run: { head_branch: 'main' } },
          ],
        },
      }),
      'https://api.github.com/dl/2': () => ({ status: 302, headers: { location: 'https://blob.example.test/2.zip' } }),
      'https://blob.example.test/2.zip': () => ({ status: 200, body: zipOf([{ name: 'flowatlas-graph.tgz', data: tgz }]) }),
    });
    const fetched = await fetchBundle('gh:acme/shop/flowatlas-graph', { token: 't', fetchImpl: impl });
    expect(fetched.etag).toBe('2');
    expect(fetched.archive?.equals(tgz)).toBe(true);
    expect(seen.find((item) => item.url.startsWith('https://blob.'))?.auth).toBe(false);
    expect((await fetchBundle('gh:acme/shop/flowatlas-graph', { token: 't', etag: '2', fetchImpl: impl })).archive).toBeUndefined();
  });

  it('needs a token for gh:, and says how to give one', async () => {
    const saved = { github: process.env['GITHUB_TOKEN'], gh: process.env['GH_TOKEN'] };
    delete process.env['GITHUB_TOKEN'];
    delete process.env['GH_TOKEN'];
    try {
      await expect(fetchBundle('gh:acme/shop/x', { ghToken: () => undefined })).rejects.toThrow(/GITHUB_TOKEN, or log in with gh auth login/);
    } finally {
      if (saved.github !== undefined) process.env['GITHUB_TOKEN'] = saved.github;
      if (saved.gh !== undefined) process.env['GH_TOKEN'] = saved.gh;
    }
  });
});

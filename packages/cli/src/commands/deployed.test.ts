import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDeployedProject } from '../../../../scripts/deployed-fixture.mjs';
import { CliError } from '../exit.js';
import { ageOf, runDeployedSet, runDeployedShow } from './deployed.js';

/** `flowatlas deployed set|show` (P117): the pins file, and nothing else, written. */
const ROOT = resolve(import.meta.dirname, '../../../..');
const quiet = { out(): void {}, err(): void {}, tty: false };

let scratch: string;
let project: string;
let config: string;

beforeAll(() => {
  ({ scratch, project, config } = makeDeployedProject(ROOT));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const pins = (): { environments: Record<string, Record<string, string>> } =>
  JSON.parse(readFileSync(join(project, 'flowatlas.deployed.json'), 'utf8'));

describe('flowatlas deployed (P117)', () => {
  it('records a ref, and with --resolve the commit it names', async () => {
    await runDeployedSet('prod', 'orders', 'drop-lookup', { config }, quiet);
    expect(pins().environments['prod']?.['orders']).toBe('drop-lookup');
    const { ref, was } = await runDeployedSet('prod', 'orders', 'drop-lookup', { config, resolve: true }, quiet);
    expect(ref).toMatch(/^[0-9a-f]{40}$/);
    expect(was).toBe('drop-lookup');
    expect(pins().environments['prod']?.['orders']).toBe(ref);
    // Everything else in the file is kept.
    expect(pins().environments['staging']).toEqual({ gateway: 'main', orders: 'main', billing: 'main' });
    await runDeployedSet('prod', 'orders', 'v1', { config }, quiet);
  });

  it('refuses a service nobody configured, and a ref that does not resolve with --resolve', async () => {
    await expect(runDeployedSet('prod', 'shop', 'v1', { config }, quiet)).rejects.toBeInstanceOf(CliError);
    await expect(runDeployedSet('prod', 'orders', 'v9', { config, resolve: true }, quiet)).rejects.toThrow(/v9 does not resolve in \.\/orders/);
  });

  it('shows each pin with its commit, its kind and its age, and warns of a branch and of a ref that is not there', async () => {
    const shown = await runDeployedShow(undefined, { config, now: '2026-01-04T00:00:00.000Z' }, quiet);
    expect(shown.environments['prod']?.find((row) => row.service === 'billing')).toMatchObject({ ref: 'v1', kind: 'tag', age: '3 days' });
    expect(shown.environments['staging']?.find((row) => row.service === 'billing')).toMatchObject({ kind: 'branch', warning: expect.stringContaining('--resolve') });
    expect(shown.environments['canary']?.find((row) => row.service === 'orders')).toMatchObject({ sha: null, kind: 'missing', warning: expect.stringContaining('fetch') });
    await expect(runDeployedShow('qa', { config }, quiet)).rejects.toThrow(/no environment named "qa"/);
  });

  it('says an age as precisely as it needs to be', () => {
    const now = Date.parse('2026-01-02T12:00:00.000Z');
    expect(ageOf('2026-01-02T11:55:00.000Z', now)).toBe('5 minutes');
    expect(ageOf('2026-01-02T09:00:00.000Z', now)).toBe('3 hours');
    expect(ageOf('2026-01-01T12:00:00.000Z', now)).toBe('1 day');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDeployedProject } from '../../../../scripts/deployed-fixture.mjs';
import { buildAtRef, UnreadableAtRef } from './build-at-ref.js';

/** A ref per repository (P117): what `check` reads each deployed service with. */
const ROOT = resolve(import.meta.dirname, '../../../..');

let scratch: string;
let config: string;
let work: string;

beforeAll(() => {
  ({ scratch, config } = makeDeployedProject(ROOT));
  work = mkdtempSync(join(scratch, 'work-'));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('buildAtRef with refFor (P117)', () => {
  it('reads two services at two refs, and a third at the working tree', async () => {
    const loaded = loadConfig(config);
    const refs: Record<string, string | null> = { billing: 'main', orders: 'v1', gateway: null };
    const built = await buildAtRef(loaded, 'ignored', { workDir: join(work, 'a'), side: 'base', cacheDir: loaded.outputDir, refFor: (service) => refs[service] ?? null });
    expect(built.sources['billing']).toMatchObject({ ref: 'main', cached: false });
    expect(built.sources['orders']).toMatchObject({ ref: 'v1', cached: false });
    expect(built.sources['gateway']).toMatchObject({ ref: null, sha: null });
    expect(built.sources['billing']?.sha).not.toBe(built.sources['orders']?.sha);
    // billing on main publishes invoice.paid; v1 never did.
    expect(built.graph.nodes.some((node) => node.id === 'channel:invoice.paid')).toBe(true);

    const again = await buildAtRef(loaded, 'ignored', { workDir: join(work, 'b'), side: 'base', cacheDir: loaded.outputDir, refFor: (service) => refs[service] ?? null });
    expect(again.sources['billing']).toMatchObject({ ref: 'main', cached: true });
    expect(again.sources['orders']).toMatchObject({ ref: 'v1', cached: true });
  }, 300_000);

  it('refuses, with fallback off, a ref the repository does not have, rather than reading its working tree', async () => {
    const loaded = loadConfig(config);
    const reading = buildAtRef(loaded, null, {
      workDir: join(work, 'c'),
      side: 'base',
      services: ['orders'],
      refFor: () => 'v9',
      fallback: false,
    });
    await expect(reading).rejects.toBeInstanceOf(UnreadableAtRef);
    await expect(reading).rejects.toMatchObject({ service: 'orders', ref: 'v9', reason: 'ref-not-found' });
    // diff's behaviour is unchanged: read as it stands, said in a warning.
    const lenient = await buildAtRef(loaded, null, { workDir: join(work, 'd'), side: 'base', services: ['orders'], refFor: () => 'v9' });
    expect(lenient.warnings.map((warning) => warning.reason)).toEqual(['ref-not-found']);
  }, 300_000);
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DeployedInvalidError,
  deployedPathOf,
  emptyDeployed,
  loadDeployed,
  parseDeployed,
  parsePinFlags,
  pinEnvName,
  pinsFor,
  pinsFromEnv,
  withPin,
  writeDeployed,
} from './deployed.js';

const SERVICES = ['gateway', 'orders', 'billing'];
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-deployed-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const FILE = {
  deployedFormatVersion: 1,
  environments: {
    prod: { orders: 'v1.8.0', billing: 'v2.3.1', gateway: '4f1c2a9' },
    staging: { orders: 'main', billing: 'main' },
  },
};

describe('the pins file (P117)', () => {
  it('reads every environment, a ref per service', () => {
    const deployed = parseDeployed(FILE, SERVICES);
    expect(deployed.environments['prod']?.['orders']).toBe('v1.8.0');
    expect(Object.keys(deployed.environments)).toEqual(['prod', 'staging']);
  });

  it('refuses a service nobody configured, rather than reading it as not deployed', () => {
    const wrong = { ...FILE, environments: { prod: { ordres: 'v1' } } };
    expect(() => parseDeployed(wrong, SERVICES)).toThrow(DeployedInvalidError);
    expect(() => parseDeployed(wrong, SERVICES)).toThrow(/environments\.prod\.ordres: no service named "ordres"/);
  });

  it('refuses another format, an unknown key and a ref with a space', () => {
    expect(() => parseDeployed({ ...FILE, deployedFormatVersion: 2 }, SERVICES)).toThrow(DeployedInvalidError);
    expect(() => parseDeployed({ ...FILE, extra: true }, SERVICES)).toThrow(DeployedInvalidError);
    expect(() => parseDeployed({ deployedFormatVersion: 1, environments: { prod: { orders: 'v 1' } } }, SERVICES)).toThrow(/no spaces/);
  });

  it('says a file that is not JSON, and none at all is null rather than empty', () => {
    const broken = join(scratch, 'broken.json');
    writeFileSync(broken, '{ nope');
    expect(() => loadDeployed(broken, SERVICES)).toThrow(/not JSON/);
    expect(loadDeployed(join(scratch, 'absent.json'), SERVICES)).toBeNull();
  });

  it('writes one pin and keeps every other, and reads back what it wrote', () => {
    const path = join(scratch, 'flowatlas.deployed.json');
    writeDeployed(path, withPin(withPin(emptyDeployed(), 'prod', 'orders', 'v1'), 'prod', 'billing', 'v2'));
    writeDeployed(path, withPin(loadDeployed(path, SERVICES) ?? emptyDeployed(), 'prod', 'orders', 'v1.1'));
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ deployedFormatVersion: 1, environments: { prod: { orders: 'v1.1', billing: 'v2' } } });
  });

  it('finds the file beside the configuration, at deployed.file, or where --pins says', () => {
    // Resolved, as the code resolves it: on Windows `/project` is on the current drive (P199).
    expect(deployedPathOf('/project')).toBe(resolve('/project', 'flowatlas.deployed.json'));
    expect(deployedPathOf('/project', 'ops/pins.json')).toBe(resolve('/project', 'ops/pins.json'));
    expect(deployedPathOf('/project', 'ops/pins.json', '/elsewhere/pins.json')).toBe('/elsewhere/pins.json');
  });
});

describe('pins from the pipeline (P117)', () => {
  it('reads --pin service=ref, and refuses one without a ref or naming nobody', () => {
    expect(parsePinFlags(['orders=v1.9.0'], SERVICES)).toEqual({ pins: { orders: 'v1.9.0' }, problems: [] });
    expect(parsePinFlags(['orders'], SERVICES).problems).toEqual(['--pin "orders" is not <service>=<ref>']);
    expect(parsePinFlags(['shop=v1'], SERVICES).problems).toEqual(['--pin "shop=v1": no service named "shop"']);
  });

  it('names the variable of a service upper-cased, every other character an underscore', () => {
    expect(pinEnvName('orders')).toBe('FLOWATLAS_PIN_ORDERS');
    expect(pinEnvName('support-bot')).toBe('FLOWATLAS_PIN_SUPPORT_BOT');
    expect(pinsFromEnv({ FLOWATLAS_PIN_BILLING: 'v2.4.0', FLOWATLAS_PIN_ORDERS: '  ', OTHER: 'x' }, SERVICES)).toEqual({ billing: 'v2.4.0' });
  });

  it('lays a variable over the file and a flag over both, and remembers whose ref it replaced', () => {
    const deployed = parseDeployed(FILE, SERVICES);
    const { pins, known } = pinsFor(deployed, 'prod', { env: { billing: 'v2.4.0' }, flags: { orders: 'v1.9.0' } });
    expect(known).toBe(true);
    expect(pins).toEqual([
      { service: 'billing', ref: 'v2.4.0', from: 'env', replaced: { ref: 'v2.3.1', from: 'file' } },
      { service: 'gateway', ref: '4f1c2a9', from: 'file' },
      { service: 'orders', ref: 'v1.9.0', from: 'flag', replaced: { ref: 'v1.8.0', from: 'file' } },
    ]);
  });

  it('knows an environment the file never names only when a pin is given for it', () => {
    expect(pinsFor(parseDeployed(FILE, SERVICES), 'canary').known).toBe(false);
    expect(pinsFor(null, 'canary', { flags: { orders: 'v1' } })).toEqual({ pins: [{ service: 'orders', ref: 'v1', from: 'flag' }], known: true });
  });
});

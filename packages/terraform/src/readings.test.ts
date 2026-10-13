import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfig, type DeploymentReadOptions } from '@flowatlas/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { terraformReader } from './index.js';

/** Every evaluation of a configuration, counted where it begins. */
const evaluations = vi.hoisted(() => ({ count: 0 }));

vi.mock('./configuration/load.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./configuration/load.js')>();
  return {
    ...actual,
    loadConfiguration: (...args: Parameters<typeof actual.loadConfiguration>) => {
      evaluations.count += 1;
      return actual.loadConfiguration(...args);
    },
  };
});

const dir = mkdtempSync(join(tmpdir(), 'flowatlas-readings-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * Writes a file as saved a minute after the one before, all of them in the past:
 * a file saved while a reading runs is one the reading does not keep.
 */
let clock = Date.now() / 1000 - 3600;
const save = (path: string, text: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
  clock += 60;
  utimesSync(join(dir, path), clock, clock);
};

const MAIN = `
resource "aws_lambda_function" "renew" {
  function_name = "renew-loan"
  handler       = "index.handler"
}

resource "aws_sfn_state_machine" "renew" {
  name       = "renew"
  role_arn   = "arn:aws:iam::000000000000:role/workflows"
  definition = file("\${path.module}/../statemachine/renew.asl.json")
}
`;

const definition = (state: string): string => JSON.stringify({ StartAt: state, States: { [state]: { Type: 'Succeed' } } });

save('infra/main.tf', MAIN);
save('infra/prod.tfvars', '');
save('statemachine/renew.asl.json', definition('Done'));

const options: DeploymentReadOptions = { repoDir: dir, config: parseConfig({}) };

/** Where the state machine starts, as the reading has its definition. */
const startOf = (reading: DeploymentReadOptions): unknown => {
  const found = terraformReader.read(reading).workflows[0]?.definition;
  if (found === undefined) return undefined;
  return (found.kind === 'value' ? (found.value as { StartAt?: string }) : JSON.parse(found.text)).StartAt;
};

/**
 * A build asks for a service's deployment for its source roots, for the files it
 * stamps and for its entries, and each answer is one reading (R176).
 */
describe('one reading of a configuration while nothing it was read from changes', () => {
  beforeEach(() => {
    evaluations.count = 0;
  });

  it('evaluates the configuration once however often it is asked', () => {
    const first = terraformReader.read(options);
    expect(terraformReader.read(options)).toBe(first);
    expect(terraformReader.read({ ...options, config: parseConfig({}) })).toBe(first);
    expect(terraformReader.files(dir, { config: parseConfig({}) })).toEqual([
      'infra/main.tf',
      'infra/prod.tfvars',
      'statemachine/renew.asl.json',
    ]);
    expect(evaluations.count).toBe(1);
  });

  it('reads again once a configuration file changes, and once only', () => {
    terraformReader.read(options);
    save('infra/main.tf', `${MAIN}\n# renewed\n`);
    terraformReader.read(options);
    terraformReader.files(dir, options);
    terraformReader.read(options);
    expect(evaluations.count).toBe(1);
  });

  it('reads again once a file the configuration loads changes, and sees what it says now', () => {
    expect(startOf(options)).toBe('Done');
    save('statemachine/renew.asl.json', definition('Finished'));
    expect(startOf(options)).toBe('Finished');
    expect(startOf(options)).toBe('Finished');
    expect(evaluations.count).toBe(1);
  });

  it('keeps a reading for each set of variable files it is read with', () => {
    const [service] = parseConfig({
      services: [{ name: 'loans', repo: '.', type: 'functions', infra: { vars: ['infra/prod.tfvars'] } }],
    }).services;
    const withVars: DeploymentReadOptions = { ...options, ...(service === undefined ? {} : { service }) };
    terraformReader.read(withVars);
    terraformReader.read(options);
    terraformReader.read(withVars);
    expect(evaluations.count).toBe(1);
  });
});

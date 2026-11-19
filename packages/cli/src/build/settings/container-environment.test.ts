import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { interpolated, readComposeFile } from './compose.js';
import { dockerBuildsOf, dockerRunsOf } from './docker-run.js';
import { dockerfileEnvironment } from './dockerfile.js';
import { readProjectSettings } from './read.js';

const lines = (...each: string[]): string => each.join('\n');

describe("a Dockerfile's environment (P325)", () => {
  it('reads both forms of ENV, several pairs on a line, quotes and lines run on', () => {
    const text = lines('FROM node:20', 'ENV PORT=4000 HOST="0.0.0.0"', 'ENV ADMIN_PORT 4100', 'ENV NAME="orders api" \\', '    LOG_LEVEL=info', '# ENV PORT=1');
    expect(dockerfileEnvironment(text)).toEqual([
      { name: 'PORT', raw: '4000' },
      { name: 'HOST', raw: '0.0.0.0' },
      { name: 'ADMIN_PORT', raw: '4100' },
      { name: 'NAME', raw: 'orders api' },
      { name: 'LOG_LEVEL', raw: 'info' },
    ]);
  });

  it('puts in the build arguments, the settings before, and defaults', () => {
    const text = lines('ARG BASE=20', 'FROM node:${BASE}', 'ARG APP_PORT=4000', 'ENV PORT=$APP_PORT', 'ENV ADMIN_PORT=${ADMIN:-4100}', 'ENV METRICS_PORT=${PORT}1');
    expect(dockerfileEnvironment(text)).toEqual([
      { name: 'PORT', raw: '4000' },
      { name: 'ADMIN_PORT', raw: '4100' },
      { name: 'METRICS_PORT', raw: '40001' },
    ]);
    expect(dockerfileEnvironment(text, { args: { APP_PORT: '5000' } })?.[0]).toEqual({ name: 'PORT', raw: '5000' });
    // A value naming what nobody settles is not read, and the setting is unknown rather than the value before it.
    expect(dockerfileEnvironment(lines('FROM node', 'ENV PORT=3000', 'ENV PORT=$RUNTIME_PORT'))).toEqual([]);
  });

  it('reads the stage built, with what the stages it is built from set', () => {
    const text = lines('FROM node:20 AS base', 'ENV PORT=3000', 'FROM base AS dev', 'ENV PORT=4000', 'FROM base AS prod', 'ENV NODE_ENV=production');
    expect(dockerfileEnvironment(text)).toEqual([
      { name: 'PORT', raw: '3000' },
      { name: 'NODE_ENV', raw: 'production' },
    ]);
    expect(dockerfileEnvironment(text, { target: 'dev' })).toEqual([{ name: 'PORT', raw: '4000' }]);
    expect(dockerfileEnvironment('ENV PORT=1')).toBeUndefined();
  });
});

describe('what compose and docker commands say a container is built and started with (P325)', () => {
  it("reads a compose container's build, and interpolates with the variables compose loads", () => {
    const text = lines(
      'services:',
      '  orders:',
      '    build:',
      '      context: ./orders',
      '      dockerfile: docker/Dockerfile',
      '      target: dev',
      '      args:',
      '        APP_PORT: ${APP_PORT:-4000}',
      '    environment:',
      '      PORT: ${PORT}',
    );
    const [orders] = readComposeFile(text, { PORT: '4200' });
    expect(orders?.image).toEqual({ dockerfile: 'docker/Dockerfile', target: 'dev', args: { APP_PORT: '4000' } });
    expect(orders?.environment).toEqual([{ name: 'PORT', raw: '4200' }]);
    expect(readComposeFile(text)[0]?.environment).toEqual([]);
    expect(interpolated('${PORT:-3000}', { PORT: '' })).toBe('3000');
    expect(interpolated('${PORT-3000}', { PORT: '' })).toBe('');
    expect(interpolated('$PORT', { PORT: '4200' })).toBe('4200');
  });

  it('reads the env files a docker run is started with and the image it runs, and the images a docker build tags', () => {
    const commands = [
      { file: 'Makefile', line: 2, dirs: ['.'], words: ['docker', 'build', '-t', 'registry.example/orders:dev', '-f', 'docker/Dockerfile', '--target', 'dev', '--build-arg', 'APP_PORT=4300', '.'] },
      { file: 'Makefile', line: 3, dirs: ['.'], words: ['docker', 'run', '-p', '8080:4300', '--env-file', '.env.docker', '--env-file=.env.ports', 'orders:dev'] },
    ];
    expect(dockerBuildsOf(commands)).toEqual([{ names: ['orders'], dockerfile: 'docker/Dockerfile', context: '.', target: 'dev', args: { APP_PORT: '4300' }, file: 'Makefile', dirs: ['.'] }]);
    expect(dockerRunsOf(commands)).toMatchObject([{ name: 'orders', envFiles: ['.env.docker', '.env.ports'], image: 'orders:dev' }]);
  });
});

describe("a container's environment, the image's under its env files under its own (P325)", () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });
  const project = (files: Record<string, string>): string => {
    root = mkdtempSync(join(tmpdir(), 'flowatlas-container-env-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return root;
  };

  it("layers a compose container's Dockerfile, its env files in order and its environment, naming the file each port is from", () => {
    const dir = project({
      'docker-compose.yml': lines(
        'services:',
        '  orders:',
        '    build: ./orders',
        '    ports:',
        '      - "8080:4000"',
        '    env_file:',
        '      - ./orders/.env',
        '      - ./orders/docker.env',
        '    environment:',
        '      HEALTH_PORT: 4900',
      ),
      'orders/Dockerfile': lines('FROM node:20', 'ENV PORT=3000 ADMIN_PORT=3100 METRICS_PORT=3200 HEALTH_PORT=3300'),
      'orders/.env': 'PORT=3500\nADMIN_PORT=4100\nAPI_TOKEN_PORT=1\nDATABASE_URL=postgres://user:pw@db:5432/orders\n',
      'orders/docker.env': 'PORT=4000\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    const [container] = read['orders']?.containers ?? [];
    expect(container?.environment).toEqual({ PORT: 4000, ADMIN_PORT: 4100, METRICS_PORT: 3200, HEALTH_PORT: 4900 });
    expect(container?.environmentFiles).toEqual({ PORT: 'orders/docker.env', ADMIN_PORT: 'orders/.env', METRICS_PORT: 'orders/Dockerfile' });
    // A file the container is started with gives it ports, never this machine's, and nothing else of a file kept to names.
    expect(read['orders']?.ports).toBeUndefined();
    expect(JSON.stringify(read['orders'])).not.toContain('postgres');
  });

  it("reads the stage and arguments compose builds with, and the ports compose's own .env interpolates", () => {
    const dir = project({
      '.env': 'APP_PORT=4400\nSECRET_TOKEN=abc\n',
      'docker-compose.yml': lines('services:', '  orders:', '    build:', '      context: ./orders', '      target: dev', '      args:', '        APP_PORT: ${APP_PORT}'),
      'orders/Dockerfile': lines('FROM node:20 AS dev', 'ARG APP_PORT=3000', 'ENV PORT=$APP_PORT', 'FROM node:20', 'ENV PORT=80'),
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.containers?.[0]?.environment).toEqual({ PORT: 4400 });
  });

  it('reads a docker run of an image a command builds, with the env files it is started with', () => {
    const dir = project({
      'orders/package.json': JSON.stringify({ name: 'orders', scripts: { image: 'docker build -t orders .', start: 'docker run -p 8080:4000 --env-file docker/run.env -e HEALTH_PORT=4900 orders:latest' } }),
      'orders/Dockerfile': lines('FROM node:20', 'ENV PORT=3000 METRICS_PORT=3200'),
      'orders/docker/run.env': 'PORT=4000\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    const [container] = read['orders']?.containers ?? [];
    expect(container?.environment).toEqual({ PORT: 4000, METRICS_PORT: 3200, HEALTH_PORT: 4900 });
    expect(container?.environmentFiles).toEqual({ PORT: 'docker/run.env', METRICS_PORT: 'Dockerfile' });
  });

  it("does not take the service's own .env into a container nothing starts with it", () => {
    const dir = project({
      'docker-compose.yml': lines('services:', '  orders:', '    build: ./orders', '    ports:', '      - "8080:3000"'),
      'orders/.env.development': 'PORT=4000\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.containers?.[0]?.environment).toEqual({});
    expect(read['orders']?.ports).toEqual({ PORT: [{ port: 4000, file: '.env.development', environment: 'development' }] });
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandsAround } from './commands.js';
import { dockerfileNodeIsBun } from './dockerfile.js';

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const repository = (files: Record<string, string>): string => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-commands-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const said = (files: Record<string, string>): string[] => commandsAround(repository(files), '.').map((command) => `${command.file}:${command.line} [${command.dirs.join(',')}] ${command.words.join(' ')}`);

describe('the commands a repository writes, read once for every reader (P263)', () => {
  it('reads every spelling of a Makefile, an included one, and one in the scripts folder', () => {
    expect(
      said({
        GNUmakefile: 'up:\n\thelm upgrade orders ./charts/orders\n',
        'deploy.mk': 'apply:\n\tkubectl apply -k overlays/production\n',
        'scripts/Makefile': 'forward:\n\tkubectl port-forward svc/orders 8080:80\n',
      }),
    ).toEqual(['GNUmakefile:2 [.] helm upgrade orders ./charts/orders', 'deploy.mk:2 [.] kubectl apply -k overlays/production', 'scripts/Makefile:2 [scripts] kubectl port-forward svc/orders 8080:80']);
  });

  it("joins a recipe line a backslash continues, as the shell is handed it", () => {
    expect(said({ Makefile: 'deploy:\n\thelm upgrade orders ./chart \\\n\t  -f values-prod.yaml\n' })).toEqual(['Makefile:2 [.] helm upgrade orders ./chart -f values-prod.yaml']);
  });

  it("keeps a command after a cd the files do not settle, with no directory", () => {
    expect(said({ 'deploy.sh': 'cd "$DEPLOY_DIR"\nkubectl apply -k overlays/production\n' })).toEqual(['deploy.sh:2 [] kubectl apply -k overlays/production']);
  });
});

describe("a Makefile's own variables, the environment of its recipes (P343)", () => {
  const envOf = (files: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      commandsAround(repository(files), '.').map((command) => [
        `${command.label}:${command.line}:${command.words.join(' ')}`,
        Object.entries(command.env)
          .map(([name, value]) => `${name}=${typeof value === 'string' ? value : `?${value.text}`}`)
          .sort()
          .join(' '),
      ]),
    );

  it('gives every recipe what the file exports, at its final value, and a target its own', () => {
    expect(
      envOf({
        Makefile: [
          'BASE = 45',
          'export PORT := $(BASE)00',
          'ADMIN_PORT = 4501',
          'export ADMIN_PORT',
          'LOCAL_ONLY = 1',
          'export LATE = early',
          'LATE = late',
          'serve: export PORT = 4700',
          'worker: METRICS_PORT = 9100',
          'serve:',
          '\tnpm start',
          'worker:',
          '\tnode worker.js --port $(METRICS_PORT) $$DATA_DIR',
        ].join('\n'),
      }),
    ).toEqual({
      'serve:11:npm start': 'ADMIN_PORT=4501 LATE=late PORT=4700',
      // A target's variable it does not export is make's, filled into the line, not the shell's.
      'worker:13:node worker.js --port 9100 $DATA_DIR': 'ADMIN_PORT=4501 LATE=late PORT=4500',
    });
  });

  it('exports every variable after a bare export, less what it unexports, and reads an included file', () => {
    expect(
      envOf({
        Makefile: ['include ports.mk', 'export', 'unexport SECRET_NAME', 'SECRET_NAME = x', 'up:', '\tnpm run dev'].join('\n'),
        'ports.mk': 'PORT ?= 4800\nPORT ?= 4900\n',
      }),
    ).toEqual({ 'up:6:npm run dev': 'PORT=4800' });
  });

  it('says a value the shell or an unset variable fills is not known', () => {
    const env = envOf({ Makefile: ['export PORT != echo 4000', 'export HOST = $(HOSTNAME)', 'up:', '\tnpm start'].join('\n') });
    expect(env['up:4:npm start']).toMatch(/^HOST=\?it is \$\(HOSTNAME\) on the command.* PORT=\?PORT is what the shell prints for echo 4000 in the Makefile$/);
  });

  it("leaves a recipe line's own variables to that line, over the file's", () => {
    expect(envOf({ Makefile: ['export PORT = 4000', 'up:', '\tPORT=4100 npm start', '\tnpm start'].join('\n') })).toEqual({ 'up:3:npm start': 'PORT=4100', 'up:4:npm start': 'PORT=4000' });
  });
});

describe('an included Makefile and the targets that build another (P350)', () => {
  const envOf = (files: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      commandsAround(repository(files), '.').map((command) => [
        `${command.file}:${command.line} ${command.label}: ${command.words.join(' ')}`,
        Object.entries(command.env)
          .map(([name, value]) => `${name}=${typeof value === 'string' ? value : `?${value.text}`}`)
          .sort()
          .join(' '),
      ]),
    );

  it("reads an included file's recipes with the including Makefile's variables, and not again on its own", () => {
    expect(
      envOf({
        Makefile: ['export PORT := 4300', 'include mk/*.mk', 'include extra.mk'].join('\n'),
        'mk/serve.mk': 'serve:\n\tnpm start\n',
        'extra.mk': 'export HOST = $(PORT).local\nworker:\n\tnode worker.js --port $(PORT)\n',
      }),
    ).toEqual({
      'mk/serve.mk:2 serve: npm start': 'HOST=4300.local PORT=4300',
      'extra.mk:3 worker: node worker.js --port 4300': 'HOST=4300.local PORT=4300',
    });
  });

  it("hands a target's variables to its prerequisites, the nearer target's over the farther's, a private one kept", () => {
    expect(
      envOf({
        Makefile: [
          'export PORT = 4000',
          'dev: export PORT = 4100',
          'dev: private export DEBUG = 1',
          'all: export PORT = 4200',
          'all: export LOG = info',
          'all: dev',
          'dev: serve',
          'serve:',
          '\tnpm start',
        ].join('\n'),
      }),
    ).toEqual({
      'Makefile:9 serve: npm start': 'PORT=4000',
      'Makefile:9 dev: npm start': 'PORT=4100',
      'Makefile:9 all: npm start': 'LOG=info PORT=4100',
    });
  });

  it('reads the same line once for a target that gives it nothing new', () => {
    expect(Object.keys(envOf({ Makefile: ['export PORT = 4000', 'all: build serve', 'build:', '\tnpm run build', 'serve:', '\tnpm start'].join('\n') }))).toEqual([
      'Makefile:4 build: npm run build',
      'Makefile:6 serve: npm start',
    ]);
  });
});

describe("a Makefile's goal, conditionals and pattern variables (P356)", () => {
  const read = (files: Record<string, string>): string[] =>
    commandsAround(repository(files), '.').map((command) =>
      [
        `${command.file}:${command.line} ${command.label}: ${command.words.join(' ')} -`,
        ...Object.entries(command.env)
          .map(([name, value]) => `${name}=${typeof value === 'string' ? value : `?${value.text}`}`)
          .sort(),
        ...(command.assumed ?? []).map((each) => `under ${each}`),
      ].join(' '),
    );

  it('settles a conditional on the goal asked, each goal read with $(MAKECMDGOALS) holding it', () => {
    expect(
      read({
        Makefile: [
          'ifeq ($(MAKECMDGOALS),dev)',
          'export PORT = 4100',
          'else ifneq ($(filter prod%,$(MAKECMDGOALS)),)',
          'export PORT = 80',
          'else',
          'export PORT = 4000',
          'endif',
          'dev prod-api serve:',
          '\tbun src/index.ts --name $(MAKECMDGOALS)',
        ].join('\n'),
      }),
    ).toEqual([
      'Makefile:9 dev: bun src/index.ts --name dev - PORT=4100',
      'Makefile:9 prod-api: bun src/index.ts --name prod-api - PORT=80',
      'Makefile:9 serve: bun src/index.ts --name serve - PORT=4000',
    ]);
  });

  it('settles ifdef, ifndef and ifeq on what the Makefile sets, and reads both branches of one it does not, saying so', () => {
    expect(
      read({
        Makefile: [
          'MODE := production',
          'ifdef MODE',
          'export NODE_ENV = $(MODE)',
          'endif',
          'ifndef MODE',
          'export NODE_ENV = never',
          'endif',
          "ifeq '$(MODE)' \"production\"",
          'export PORT = 8080',
          'endif',
          'ifeq ($(CI),true)',
          'export LOG = quiet',
          'else',
          'export LOG = loud',
          'endif',
          'serve:',
          '\tnode server.js',
        ].join('\n'),
      }),
    ).toEqual([
      'Makefile:17 serve: node server.js - LOG=quiet NODE_ENV=production PORT=8080 under ifeq ($(CI),true) (Makefile:11)',
      'Makefile:17 serve: node server.js - LOG=loud NODE_ENV=production PORT=8080 under ifeq ($(CI),true) (Makefile:11)',
    ]);
  });

  it('reads a recipe line under an unsettled conditional in each branch it is in', () => {
    expect(read({ Makefile: ['serve:', 'ifdef DEBUG', '\tnode --inspect server.js', 'else', '\tnode server.js', 'endif'].join('\n') })).toEqual([
      'Makefile:3 serve: node --inspect server.js - under ifdef DEBUG (Makefile:2)',
      'Makefile:5 serve: node server.js - under ifdef DEBUG (Makefile:2)',
    ]);
  });

  it('leaves a command no conditional touches unmarked, and a value $(shell) decides unsettled', () => {
    expect(
      read({
        Makefile: ['ifeq ($(shell uname),Darwin)', 'OPEN = open', 'endif', 'export PORT = 4000', 'serve:', '\tnode server.js'].join('\n'),
      }),
    ).toEqual(['Makefile:6 serve: node server.js - PORT=4000']);
  });

  it("applies a pattern's variables to the targets it matches, a target's own and a shorter stem's over the others", () => {
    expect(
      read({
        Makefile: [
          '%-dev: export NODE_ENV = development',
          '%-dev: export PORT = 4000',
          'a%: export PORT = 4100',
          'api-dev: export LOG = debug',
          'web-dev: export PORT = 4200',
          'api-dev web-dev api-prod:',
          '\tnode server.js',
        ].join('\n'),
      }),
    ).toEqual([
      'Makefile:7 api-dev: node server.js - LOG=debug NODE_ENV=development PORT=4000',
      'Makefile:7 web-dev: node server.js - NODE_ENV=development PORT=4200',
      'Makefile:7 api-prod: node server.js - PORT=4100',
    ]);
  });

  it("hands a pattern's variables on to the prerequisites of a target it matches", () => {
    expect(read({ Makefile: ['%-dev: export PORT = 4300', 'api-dev: serve', 'serve:', '\tnode server.js'].join('\n') })).toEqual([
      'Makefile:4 serve: node server.js -',
      'Makefile:4 api-dev: node server.js - PORT=4300',
    ]);
  });
});

describe("whether an image's node is Bun (P356)", () => {
  it('says yes where a stage links or copies Bun to node, maybe on an image of Bun, and nothing on another', () => {
    expect(dockerfileNodeIsBun('FROM debian:12\nRUN apt-get update && ln -s /usr/local/bin/bun /usr/local/bin/node\n')).toBe('yes');
    expect(dockerfileNodeIsBun('FROM oven/bun:1 AS base\nRUN ln -sf $(which bun) /usr/bin/node\nFROM base\nCMD ["node", "index.js"]\n')).toBe('yes');
    expect(dockerfileNodeIsBun('FROM debian:12\nCOPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/node\n')).toBe('yes');
    expect(dockerfileNodeIsBun('FROM oven/bun:1-slim\nCMD ["node", "index.js"]\n')).toBe('maybe');
    expect(dockerfileNodeIsBun('FROM oven/bun:1 AS build\nRUN bun install\nFROM node:22\nCMD ["node", "index.js"]\n')).toBeUndefined();
    expect(dockerfileNodeIsBun('FROM node:22\nRUN ln -s /usr/local/bin/node /usr/local/bin/nodejs\n')).toBeUndefined();
  });
});

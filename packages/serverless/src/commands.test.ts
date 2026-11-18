import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandsAround } from './commands.js';

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

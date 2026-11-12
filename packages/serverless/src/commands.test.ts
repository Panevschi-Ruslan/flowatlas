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

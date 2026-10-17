import { readFileSync } from 'node:fs';
import { startStdioServer } from './server.js';

/**
 * This package's own version, for `initialize` (P86). `flowatlas mcp` passes the
 * command's instead, which is what a user installed; this bin is only run from
 * a checkout, where the manifest sits one folder above `dist/`.
 */
const manifestVersion = (): string | undefined => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
};

/** `--config <path>` and `--db <path>`, kept deliberately small. */
const readArgs = (argv: readonly string[]): { configPath?: string; dbPath?: string } => {
  const out: { configPath?: string; dbPath?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--config' && value !== undefined) {
      out.configPath = value;
      index += 1;
    } else if (flag === '--db' && value !== undefined) {
      out.dbPath = value;
      index += 1;
    }
  }
  return out;
};

const args = readArgs(process.argv.slice(2));
const fromEnv = process.env['FLOWATLAS_DB'];

// Nothing given at all means "the project I am standing in".
const options = {
  ...(args.configPath === undefined && args.dbPath === undefined && fromEnv === undefined
    ? { configPath: process.cwd() }
    : {}),
  ...(args.configPath === undefined ? {} : { configPath: args.configPath }),
  ...(args.dbPath ?? fromEnv ? { dbPath: args.dbPath ?? fromEnv } : {}),
};

const version = manifestVersion();
await startStdioServer({ ...options, ...(version === undefined ? {} : { version }) });

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isZip, ZipError, zipEntries } from './zip.js';

const archive = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/multi-repo/traces/playwright/orders-cancel-firefox/network.zip'),
);

/** A one-entry archive stored without compression, as some writers do. */
const stored = (name: string, text: string): Buffer => {
  const data = Buffer.from(text);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBytes.length, 12);
  end.writeUInt32LE(30 + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
};

describe('a zip archive (P205)', () => {
  it('lists the entries of the archive Playwright writes for a .zip HAR path, and unpacks one when asked', () => {
    expect(isZip(archive)).toBe(true);
    const entries = zipEntries(archive);
    expect(entries.map((entry) => entry.name)).toEqual(['har.har', expect.stringMatching(/^[0-9a-f]{40}\.json$/), expect.stringMatching(/^[0-9a-f]{40}\.json$/)]);
    const har = JSON.parse(entries[0]!.read(1024 * 1024).toString('utf8')) as { log: { entries: unknown[] } };
    expect(har.log.entries).toHaveLength(1);
  });

  it('reads a stored entry too', () => {
    const [entry] = zipEntries(stored('a.json', '{"a":1}'));
    expect(entry!.read(100).toString()).toBe('{"a":1}');
  });

  it('refuses an entry over the size asked for, and an archive cut short', () => {
    const [entry] = zipEntries(stored('a.json', '{"a":1}'));
    expect(() => entry!.read(3)).toThrow(ZipError);
    expect(() => zipEntries(archive.subarray(0, archive.length - 30))).toThrow(ZipError);
    expect(isZip(Buffer.from('{"log":{}}'))).toBe(false);
  });
});

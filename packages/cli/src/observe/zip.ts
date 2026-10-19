import { inflateRawSync } from 'node:zlib';

/**
 * The entries of a zip archive, read from its central directory (P205): what
 * Playwright writes for `recordHar: { path: 'network.zip' }`, a `har.har` and
 * the bodies it attached beside it. Stored (method 0) and deflated (method 8)
 * entries are read; an entry is unpacked only when asked for, and only up to
 * `limit` bytes. No zip64, no encryption, no spanning: such an archive is
 * refused as one that cannot be read.
 */
export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  /** The entry's size once unpacked, as the directory says. */
  size: number;
  /** The entry unpacked; throws `ZipError` when it cannot be, or is over `limit` bytes. */
  read(limit: number): Buffer;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

/** Whether the bytes start as a zip archive does. */
export const isZip = (bytes: Buffer): boolean => bytes.length >= 4 && bytes.readUInt32LE(0) === LOCAL;

/** The end-of-central-directory record, searched for back from the end past a comment of at most 64 KiB. */
const endOf = (bytes: Buffer): number => {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (bytes.readUInt32LE(at) === END) return at;
  }
  throw new ZipError('no central directory');
};

export const zipEntries = (bytes: Buffer): ZipEntry[] => {
  const end = endOf(bytes);
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== CENTRAL) throw new ZipError(`entry ${index} of the central directory cannot be read`);
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x800 ? 'utf8' : 'latin1');
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size,
      read: (limit) => {
        if (flags & 0x1) throw new ZipError(`${name} is encrypted`);
        if (size > limit || compressed === 0xffffffff) throw new ZipError(`${name} is over the size read`);
        if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== LOCAL) throw new ZipError(`${name} cannot be found`);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const data = bytes.subarray(start, start + compressed);
        if (method === 0) return Buffer.from(data);
        if (method !== 8) throw new ZipError(`${name} is packed in a way this does not read (method ${method})`);
        try {
          return inflateRawSync(data, { maxOutputLength: Math.max(limit, 1) });
        } catch {
          throw new ZipError(`${name} cannot be unpacked`);
        }
      },
    });
  }
  return entries;
};

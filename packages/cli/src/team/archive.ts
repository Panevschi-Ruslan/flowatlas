import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

/**
 * The two archive formats a team's graph travels in (P236), read and written
 * here so the command needs no package for either: a gzipped tar, which is
 * what `publish` writes, and a zip, which is what a GitHub Actions artifact
 * downloads as. Only what these files need: regular files, names under 100
 * characters in a tar, stored or deflated entries in a zip.
 */
export interface ArchiveFile {
  name: string;
  data: Buffer;
}

const BLOCK = 512;

const octal = (value: number, width: number): string => `${value.toString(8).padStart(width - 1, '0')}\0`;

const header = (name: string, size: number): Buffer => {
  if (Buffer.byteLength(name) > 99) throw new Error(`a name too long for the archive: ${name}`);
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name, 0, 'utf8');
  block.write(octal(0o644, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  // A fixed time: the same graph makes the same archive.
  block.write(octal(0, 12), 136, 'ascii');
  block.write('        ', 148, 'ascii');
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
};

/** The files as a gzipped tar. */
export const writeTarGz = (files: readonly ArchiveFile[]): Buffer => {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(header(file.name, file.data.length), file.data);
    const pad = (BLOCK - (file.data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(parts));
};

/** The regular files of a gzipped tar. */
export const readTarGz = (archive: Buffer): ArchiveFile[] => {
  const tar = gunzipSync(archive);
  const files: ArchiveFile[] = [];
  for (let at = 0; at + BLOCK <= tar.length; ) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const name = block.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(block.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(block[156] ?? 0);
    const start = at + BLOCK;
    if (type === '0' || type === '\0') files.push({ name: prefix === '' ? name : `${prefix}/${name}`, data: Buffer.from(tar.subarray(start, start + size)) });
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
};

/** The files of a zip, from its central directory: stored or deflated entries. */
export const readZip = (zip: Buffer): ArchiveFile[] => {
  // The end of central directory record, searched for from the end (it may carry a comment).
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 65_557); at -= 1) {
    if (zip.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: ArchiveFile[] = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('a broken zip central directory');
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(dataAt, dataAt + compressed);
    if (method !== 0 && method !== 8) throw new Error(`zip entry ${name} is compressed a way this cannot read (method ${method})`);
    files.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
  }
  return files;
};

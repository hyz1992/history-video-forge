/**
 * Minimal ZIP file creator — no external dependencies.
 *
 * Creates a valid ZIP archive (PKZIP 2.0 compatible) with stored (uncompressed)
 * entries. Sufficient for small publish package exports.
 *
 * ZIP format layout:
 *   [Local File Header + File Data] × N
 *   [Central Directory Entry] × N
 *   [End of Central Directory Record]
 */

export interface ZipEntry {
  filename: string;
  data: Buffer;
}

export function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  const fileDataChunks: Buffer[] = [];
  let centralOffset = 0;

  for (const entry of entries) {
    const filenameBytes = Buffer.from(entry.filename, "utf8");
    const crc = crc32(entry.data);

    // Local file header
    const localHeader = Buffer.alloc(30 + filenameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);          // version needed
    localHeader.writeUInt16LE(0x0800, 6);      // flags (UTF-8)
    localHeader.writeUInt16LE(0, 8);           // compression (stored)
    localHeader.writeUInt16LE(0, 10);          // mod time
    localHeader.writeUInt16LE(0, 12);          // mod date
    localHeader.writeUInt32LE(crc, 14);         // CRC-32
    localHeader.writeUInt32LE(entry.data.length, 18); // compressed size
    localHeader.writeUInt32LE(entry.data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(filenameBytes.length, 26); // filename length
    localHeader.writeUInt16LE(0, 28);          // extra field length
    filenameBytes.copy(localHeader, 30);
    localHeaders.push(localHeader);

    fileDataChunks.push(entry.data);

    // Central directory entry
    const centralEntry = Buffer.alloc(46 + filenameBytes.length);
    centralEntry.writeUInt32LE(0x02014b50, 0); // signature
    centralEntry.writeUInt16LE(20, 4);          // version made by
    centralEntry.writeUInt16LE(20, 6);          // version needed
    centralEntry.writeUInt16LE(0x0800, 8);      // flags (UTF-8)
    centralEntry.writeUInt16LE(0, 10);          // compression
    centralEntry.writeUInt16LE(0, 12);          // mod time
    centralEntry.writeUInt16LE(0, 14);          // mod date
    centralEntry.writeUInt32LE(crc, 16);         // CRC-32
    centralEntry.writeUInt32LE(entry.data.length, 20); // compressed size
    centralEntry.writeUInt32LE(entry.data.length, 24); // uncompressed size
    centralEntry.writeUInt16LE(filenameBytes.length, 28); // filename length
    centralEntry.writeUInt16LE(0, 30);          // extra field length
    centralEntry.writeUInt16LE(0, 32);          // comment length
    centralEntry.writeUInt16LE(0, 34);          // disk start
    centralEntry.writeUInt16LE(0, 36);          // internal attrs
    centralEntry.writeUInt32LE(0, 38);          // external attrs
    centralEntry.writeUInt32LE(centralOffset, 42); // local header offset
    filenameBytes.copy(centralEntry, 46);
    centralHeaders.push(centralEntry);

    centralOffset += localHeader.length + entry.data.length;
  }

  // End of central directory record
  const eocd = Buffer.alloc(22);
  const centralSize = centralHeaders.reduce((s, b) => s + b.length, 0);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);          // disk number
  eocd.writeUInt16LE(0, 6);          // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);  // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);    // central dir size
  eocd.writeUInt32LE(centralOffset, 16);  // central dir offset
  eocd.writeUInt16LE(0, 20);         // comment length

  return Buffer.concat([
    ...localHeaders,
    ...fileDataChunks,
    ...centralHeaders,
    eocd,
  ]);
}

// CRC-32 (IEEE 802.3) lookup table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates a UTF-8 ZIP archive using stored entries for already compressed images.
 * @param {{name: string, blob: Blob}[]} files
 * @returns {Promise<Blob>}
 */
export async function createZip(files) {
  if (files.length > 65535) throw new Error('Слишком много файлов для ZIP.');
  /** @type {BlobPart[]} */
  const parts = [];
  /** @type {BlobPart[]} */
  const directory = [];
  const names = new Set();
  let offset = 0;
  let directoryBytes = 0;
  for (const file of files) {
    const safeName = file.name.replace(/[\\/]/g, '_');
    const extensionAt = safeName.lastIndexOf('.');
    const base = extensionAt > 0 ? safeName.slice(0, extensionAt) : safeName;
    const extension = extensionAt > 0 ? safeName.slice(extensionAt) : '';
    let name = safeName;
    let suffix = 2;
    while (names.has(name.toLowerCase())) {
      name = `${base}-${suffix++}${extension}`;
    }
    names.add(name.toLowerCase());
    const encodedName = new TextEncoder().encode(name);
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const header = new Uint8Array(30);
    const local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(12, 33, true);
    const checksum = crc32(data);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, encodedName.length, true);
    const centralBytes = new Uint8Array(46);
    const central = new DataView(centralBytes.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x800, true);
    central.setUint16(14, 33, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, encodedName.length, true);
    central.setUint32(42, offset, true);
    offset += header.length + encodedName.length + data.length;
    directoryBytes += centralBytes.length + encodedName.length;
    if (encodedName.length > 65535 || offset + directoryBytes + 22 > 0xffffffff) {
      throw new Error('Размер ZIP превышает поддерживаемый предел.');
    }
    parts.push(header, encodedName, data);
    directory.push(centralBytes, encodedName);
  }
  const endBytes = new Uint8Array(22);
  const end = new DataView(endBytes.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directoryBytes, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, endBytes], { type: 'application/zip' });
}

/** @param {Uint8Array} bytes @returns {number} */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

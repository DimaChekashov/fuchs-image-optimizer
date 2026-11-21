import sharp from 'sharp';
import { AppError } from './errors.js';
import { MAX_INPUT_PIXELS } from './limits.js';

/**
 * Encodes a single image and yields output bytes with backpressure.
 * @param {Buffer} input
 * @param {import('./options.js').CompressionOptions} options Validated settings.
 * @param {number} maxPixels Pixel limit, overridable for tests.
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* encodeImage(input, options, maxPixels = MAX_INPUT_PIXELS) {
  validateContainer(input);
  const image = sharp(input, { limitInputPixels: maxPixels, failOn: 'warning' });
  try {
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) > 1) {
      throw new AppError('UNSUPPORTED_FORMAT');
    }
    if (!metadata.width || !metadata.height) {
      throw new AppError('INVALID_IMAGE');
    }
    if (metadata.width * metadata.height > maxPixels) {
      throw new AppError('PIXEL_LIMIT');
    }
    image.autoOrient();
    switch (options.format) {
      case 'jpeg':
        image.flatten({ background: '#ffffff' }).jpeg({ quality: options.quality });
        break;
      case 'png':
        image.png({ compressionLevel: options.compressionLevel, palette: false });
        break;
      case 'webp':
        image.webp({ quality: options.quality });
        break;
    }
    for await (const chunk of image) {
      yield chunk;
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new AppError('PIXEL_LIMIT');
    }
    throw new AppError('INVALID_IMAGE');
  } finally {
    image.destroy();
  }
}

/**
 * Checks supported signatures and animation flags before decoding.
 * @param {Buffer} input
 * @returns {void}
 */
function validateContainer(input) {
  if (input.length >= 3 && input[0] === 0xff
    && input[1] === 0xd8 && input[2] === 0xff) {
    return;
  }
  const isPng = input.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const isWebp = input.length >= 12
    && input.toString('ascii', 0, 4) === 'RIFF'
    && input.toString('ascii', 8, 12) === 'WEBP';
  if (!isPng && !isWebp) {
    throw new AppError('UNSUPPORTED_FORMAT');
  }
  if (isWebp && input.readUInt32LE(4) + 8 !== input.length) {
    throw new AppError('INVALID_IMAGE');
  }
  let offset = isPng ? 8 : 12;
  while (offset < input.length) {
    const headerBytes = isPng ? 12 : 8;
    if (input.length - offset < headerBytes) {
      throw new AppError('INVALID_IMAGE');
    }
    const size = isPng ? input.readUInt32BE(offset) : input.readUInt32LE(offset + 4);
    const typeOffset = isPng ? offset + 4 : offset;
    const type = input.toString('ascii', typeOffset, typeOffset + 4);
    const end = offset + headerBytes + size + (isPng ? 0 : size % 2);
    if (end > input.length) {
      throw new AppError('INVALID_IMAGE');
    }
    if ((isPng && type === 'acTL')
      || (isWebp && (type === 'ANIM' || type === 'ANMF'
        || (type === 'VP8X' && size >= 1 && (input[offset + 8] & 2) !== 0)))) {
      throw new AppError('UNSUPPORTED_FORMAT');
    }
    offset = end;
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { encodeImage } from '../src/codec.js';
import { AppError } from '../src/errors.js';

/**
 * @param {Buffer} input
 * @param {import('../src/options.js').CompressionOptions} options
 * @param {number} [limit]
 * @returns {Promise<Buffer>}
 */
async function encode(input, options, limit) {
  const chunks = [];
  for await (const chunk of encodeImage(input, options, limit)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

test('each input format converts to every output format with original dimensions', async () => {
  const source = sharp({
    create: { width: 7, height: 5, channels: 3, background: '#336699' },
  });
  const inputs = await Promise.all([
    source.clone().jpeg().toBuffer(),
    source.clone().png().toBuffer(),
    source.clone().webp().toBuffer(),
  ]);
  /** @type {import('../src/options.js').CompressionOptions[]} */
  const settings = [
    { format: 'jpeg', quality: 80 },
    { format: 'png', compressionLevel: 6 },
    { format: 'webp', quality: 80 },
  ];
  for (const input of inputs) {
    for (const options of settings) {
      const output = await encode(input, options);
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, options.format);
      assert.equal(metadata.width, 7);
      assert.equal(metadata.height, 5);
      await sharp(output).raw().toBuffer();
    }
  }
});

test('alpha survives PNG/WebP and becomes white in JPEG', async () => {
  const input = await sharp({
    create: { width: 3, height: 2, channels: 4, background: '#00000000' },
  }).png().toBuffer();
  for (const format of ['png', 'webp']) {
    /** @type {import('../src/options.js').CompressionOptions} */
    const options = format === 'png'
      ? { format: 'png', compressionLevel: 6 }
      : { format: 'webp', quality: 80 };
    const output = await encode(input, options);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    assert.equal(data[3], 0);
  }
  const jpeg = await encode(input, { format: 'jpeg', quality: 100 });
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  assert.ok(data.every((value) => value >= 250));
});

test('EXIF orientation is applied and source metadata is removed', async () => {
  const input = await sharp({
    create: { width: 7, height: 5, channels: 3, background: '#336699' },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const output = await encode(input, { format: 'png', compressionLevel: 6 });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 5);
  assert.equal(metadata.height, 7);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test('unsupported, truncated, animated and oversized inputs return stable errors', async () => {
  const png = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  const webp = await sharp(png).webp().toBuffer();
  const damagedPng = Buffer.from(png);
  const idatOffset = damagedPng.indexOf(Buffer.from('IDAT'));
  assert.ok(idatOffset > 0);
  damagedPng[idatOffset + 4] ^= 255;
  // Insert an acTL chunk before IDAT. Container validation precedes decoding.
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8, 0);
  animation.write('acTL', 4);
  animation.writeUInt32BE(2, 8);
  const apng = Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]);
  const animatedWebp = Buffer.alloc(30);
  animatedWebp.write('RIFF');
  animatedWebp.writeUInt32LE(22, 4);
  animatedWebp.write('WEBPVP8X', 8);
  animatedWebp.writeUInt32LE(10, 16);
  animatedWebp[20] = 2;

  for (const { input, code, limit } of [
    { input: Buffer.from('GIF89a'), code: 'UNSUPPORTED_FORMAT' },
    { input: png.subarray(0, 40), code: 'INVALID_IMAGE' },
    { input: damagedPng, code: 'INVALID_IMAGE' },
    { input: webp.subarray(0, 20), code: 'INVALID_IMAGE' },
    { input: Buffer.from([255, 216, 255, 0]), code: 'INVALID_IMAGE' },
    { input: apng, code: 'UNSUPPORTED_FORMAT' },
    { input: animatedWebp, code: 'UNSUPPORTED_FORMAT' },
    { input: png, code: 'PIXEL_LIMIT', limit: 5 },
  ]) {
    await assert.rejects(
      encode(input, { format: 'png', compressionLevel: 6 }, limit),
      (error) => error instanceof AppError && error.code === code,
    );
  }
});

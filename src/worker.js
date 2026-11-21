import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encodeImage } from './codec.js';
import { AppError } from './errors.js';
import { MAX_INPUT_BYTES } from './limits.js';
import { parseOptions } from './options.js';

try {
  const options = parseOptions(new URLSearchParams(process.argv[2]));
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) {
      throw new AppError('INPUT_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (bytes === 0) {
    throw new AppError('EMPTY_INPUT');
  }
  await pipeline(Readable.from(encodeImage(Buffer.concat(chunks), options)), process.stdout);
} catch (error) {
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  process.stderr.write(code);
  process.exitCode = 1;
}

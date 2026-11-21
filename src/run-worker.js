import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AppError, ERROR_DEFINITIONS } from './errors.js';
import { MAX_OUTPUT_BYTES, PROCESSING_TIMEOUT_MS } from './limits.js';

/**
 * @typedef {object} WorkerSettings
 * @property {AbortSignal} [signal]
 * @property {number} [timeoutMs]
 * @property {number} [maxOutputBytes]
 * @property {(args: string[]) => import('node:child_process').ChildProcessWithoutNullStreams} [createProcess]
 */

/**
 * Resolves only after the process and its pipes close. Cancellation rejects with AbortError.
 * @param {Buffer} input
 * @param {import('./options.js').CompressionOptions} options
 * @param {WorkerSettings} [settings]
 * @returns {Promise<Buffer>}
 */
export async function runWorker(input, options, settings = {}) {
  const { signal, timeoutMs = PROCESSING_TIMEOUT_MS,
    maxOutputBytes = MAX_OUTPUT_BYTES, createProcess = spawnWorker } = settings;
  if (signal?.aborted) {
    throw new DOMException('Processing cancelled.', 'AbortError');
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    query.set(key, String(value));
  }
  let child;
  try {
    child = createProcess([
      fileURLToPath(new URL('./worker.js', import.meta.url)), query.toString(),
    ]);
  } catch {
    throw new AppError('INTERNAL_ERROR');
  }
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let outputBytes = 0;
    let stderr = Buffer.alloc(0);
    /** @type {Error | undefined} */
    let failure;
    let inputFailed = false;

    /** @param {Error} error */
    const stop = (error) => {
      if (failure) return;
      failure = error;
      chunks.length = 0;
      child.kill('SIGKILL');
    };
    const abort = () => stop(new DOMException('Processing cancelled.', 'AbortError'));
    const timer = setTimeout(() => stop(new AppError('PROCESSING_TIMEOUT')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    const onError = () => stop(new AppError('INTERNAL_ERROR'));
    const onInputError = () => { inputFailed = true; };
    /** @param {Buffer} chunk */
    const onOutput = (chunk) => {
      if (failure) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        stop(new AppError('OUTPUT_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    };
    /** @param {Buffer} chunk */
    const onStderr = (chunk) => {
      if (failure) return;
      if (stderr.length + chunk.length > 4096) {
        stop(new AppError('INTERNAL_ERROR'));
        return;
      }
      stderr = Buffer.concat([stderr, chunk]);
    };
    child.on('error', onError);
    child.stdin.on('error', onInputError);
    child.stdout.on('error', onError);
    child.stderr.on('error', onError);
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onStderr);
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.removeListener('error', onError);
      child.stdin.removeListener('error', onInputError);
      child.stdout.removeListener('error', onError);
      child.stderr.removeListener('error', onError);
      child.stdout.removeListener('data', onOutput);
      child.stderr.removeListener('data', onStderr);
      const errorCode = stderr.toString();
      stderr = Buffer.alloc(0);
      if (failure) {
        reject(failure);
      } else if (code === 1 && isErrorCode(errorCode)) {
        reject(new AppError(errorCode));
      } else if (code !== 0 || inputFailed || errorCode.length > 0 || outputBytes === 0) {
        reject(new AppError('INTERNAL_ERROR'));
      } else {
        resolve(Buffer.concat(chunks, outputBytes));
      }
      chunks.length = 0;
    });
    if (signal?.aborted) {
      abort();
    } else {
      child.stdin.end(input);
    }
  });
}

/**
 * @param {string[]} args
 * @returns {import('node:child_process').ChildProcessWithoutNullStreams}
 */
function spawnWorker(args) {
  return spawn(process.execPath, args, { stdio: 'pipe', windowsHide: true });
}

/**
 * @param {string} value
 * @returns {value is import('./errors.js').ErrorCode}
 */
function isErrorCode(value) {
  return Object.hasOwn(ERROR_DEFINITIONS, value);
}

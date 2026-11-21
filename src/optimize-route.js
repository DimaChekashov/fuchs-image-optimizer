import { AppError } from './errors.js';
import { MAX_INPUT_BYTES, UPLOAD_TIMEOUT_MS } from './limits.js';
import { parseOptions } from './options.js';
import { runWorker } from './run-worker.js';

/**
 * @typedef {object} OptimizeSettings
 * @property {number} [maxInputBytes]
 * @property {number} [uploadTimeoutMs]
 * @property {import('./run-worker.js').WorkerSettings} [workerSettings]
 * @property {AbortSignal} [signal] Application shutdown signal.
 */

/**
 * Creates one processing slot shared by all requests to a server.
 * @param {OptimizeSettings} [settings]
 * @returns {(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => Promise<void>}
 */
export function createOptimizeRoute(settings = {}) {
  let busy = false;
  return async (request, response) => {
    const origin = `http://${request.headers.host}`;
    if (request.headers.origin !== undefined && request.headers.origin !== origin) {
      throw new AppError('FORBIDDEN_ORIGIN');
    }
    const options = parseOptions(new URL(request.url ?? '/', origin).searchParams);
    if (request.headers['content-type'] !== 'application/octet-stream') {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE');
    }
    if (busy) throw new AppError('BUSY');
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const { promise: finished, resolve: onFinished } = Promise.withResolvers();
    response.once('finish', onFinished);
    response.once('close', onFinished);
    response.once('close', abort);
    settings.signal?.addEventListener('abort', abort, { once: true });
    try {
      if (settings.signal?.aborted) controller.abort();
      const input = await readInput(request, controller.signal,
        settings.maxInputBytes ?? MAX_INPUT_BYTES,
        settings.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS);
      const output = await runWorker(input, options, {
        ...settings.workerSettings, signal: controller.signal,
      });
      if (!response.destroyed) {
        response.writeHead(200, {
          'Content-Type': `image/${options.format}`,
          'Content-Length': output.length,
          'Cache-Control': 'no-store',
        });
        response.end(output);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        sendError(response, error);
      } else {
        response.destroy();
      }
    } finally {
      await finished;
      response.removeListener('close', abort);
      response.removeListener('finish', onFinished);
      response.removeListener('close', onFinished);
      settings.signal?.removeEventListener('abort', abort);
      busy = false;
    }
  };
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {AbortSignal} signal
 * @param {number} maxBytes
 * @param {number} timeoutMs
 * @returns {Promise<Buffer>}
 */
function readInput(request, signal, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    /** @param {unknown} error */
    const fail = (error) => {
      cleanup();
      request.pause();
      chunks.length = 0;
      reject(error);
    };
    const onAbort = () => fail(new DOMException('Upload cancelled.', 'AbortError'));
    const onError = () => fail(new AppError('INVALID_IMAGE'));
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new AppError('INPUT_TOO_LARGE'));
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      cleanup();
      if (bytes === 0) {
        reject(new AppError('EMPTY_INPUT'));
      } else {
        resolve(Buffer.concat(chunks, bytes));
      }
    };
    const timer = setTimeout(() => fail(new AppError('UPLOAD_TIMEOUT')), timeoutMs);
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else if (Number(request.headers['content-length']) > maxBytes) {
      fail(new AppError('INPUT_TOO_LARGE'));
    }
  });
}

/**
 * Sends the stable public error contract and closes unread request bodies.
 * @param {import('node:http').ServerResponse} response
 * @param {unknown} error
 * @returns {void}
 */
export function sendError(response, error) {
  if (!(error instanceof AppError)) console.error('HTTP request failed', error);
  const publicError = error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
  if (response.destroyed || response.headersSent) return;
  response.writeHead(publicError.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'close',
  });
  response.end(JSON.stringify({
    error: { code: publicError.code, message: publicError.message },
  }));
}

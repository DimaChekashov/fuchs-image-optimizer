import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import sharp from 'sharp';
import { createAppServer } from '../src/server.js';

/**
 * @param {import('node:test').TestContext} t
 * @param {import('../src/optimize-route.js').OptimizeSettings} [settings]
 */
async function start(t, settings) {
  const server = createAppServer(settings);
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}/api/optimize?format=webp` };
}

/**
 * @param {string} url
 * @param {Buffer} body
 * @param {import('node:http').OutgoingHttpHeaders} [headers]
 * @returns {Promise<{status: number | undefined, headers: import('node:http').IncomingHttpHeaders, body: Buffer}>}
 */
function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = request(url, { method: 'POST', headers: {
      'Content-Type': 'application/octet-stream', ...headers,
    } }, (response) => {
      /** @type {Buffer[]} */
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks),
      }));
    });
    client.on('error', reject);
    client.end(body);
  });
}

test('optimization API returns a complete WebP with binary response headers', async (t) => {
  const { url } = await start(t);
  const input = await sharp({
    create: { width: 4, height: 3, channels: 3, background: 'red' },
  }).png().toBuffer();
  const result = await post(url + '&quality=80', input);
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'image/webp');
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(Number(result.headers['content-length']), result.body.length);
  const metadata = await sharp(result.body).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 3);
  await sharp(result.body).raw().toBuffer();
});

test('API error contract and input size checks, including chunked uploads', async (t) => {
  const { url } = await start(t, { maxInputBytes: 8 });
  for (const { suffix = '', body = Buffer.alloc(0), headers = {}, status, code } of [
    { status: 400, code: 'EMPTY_INPUT' },
    { suffix: '&quality=0', status: 400, code: 'INVALID_OPTIONS' },
    { headers: { 'Content-Type': 'text/plain' }, status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' },
    { headers: { Origin: 'http://example.com' }, status: 403, code: 'FORBIDDEN_ORIGIN' },
    { body: Buffer.from([255, 216, 255, 0]), status: 422, code: 'INVALID_IMAGE' },
    { body: Buffer.from('GIF89a'), status: 415, code: 'UNSUPPORTED_FORMAT' },
    { body: Buffer.alloc(9), headers: { 'Content-Length': '9' }, status: 413, code: 'INPUT_TOO_LARGE' },
    { body: Buffer.alloc(9), headers: { 'Transfer-Encoding': 'chunked' }, status: 413, code: 'INPUT_TOO_LARGE' },
  ]) {
    const result = await post(url + suffix, body, headers);
    assert.equal(result.status, status, code);
    assert.match(String(result.headers['content-type']), /^application\/json/);
    const json = JSON.parse(result.body.toString());
    assert.equal(json.error.code, code);
    assert.equal(typeof json.error.message, 'string');
  }
});

test('one slot rejects concurrency and recovers from interrupted or timed out uploads', async (t) => {
  const { server, url } = await start(t, { uploadTimeoutMs: 1000 });
  for (const mode of ['abort', 'timeout']) {
    const received = once(server, 'request');
    const client = request(url, { method: 'POST', headers: {
      'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked',
    } });
    client.on('error', () => {});
    client.write('partial');
    const [, response] = await received;
    assert.equal((await post(url, Buffer.alloc(0))).status, 429);
    if (mode === 'abort') {
      const closed = once(response, 'close');
      client.destroy();
      await closed;
    } else {
      // The timer is installed before the request callback yields.
      const reply = once(client, 'response');
      const [message] = await reply;
      assert.equal(message.statusCode, 408);
      message.resume();
      await once(message, 'end');
    }
    await nextTurn();
    assert.equal((await post(url, Buffer.alloc(0))).status, 400);
    client.destroy();
  }
});

test('processing timeout, disconnect and shutdown close the worker', async (t) => {
  for (const mode of ['timeout', 'abort', 'shutdown']) {
    const shutdown = new AbortController();
    const ready = Promise.withResolvers();
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams | undefined} */
    let child;
    let first = true;
    const { url } = await start(t, { signal: shutdown.signal, workerSettings: {
      timeoutMs: 1000,
      createProcess: (args) => {
        child = spawn(process.execPath, first ? [
          fileURLToPath(new URL('./helpers/worker-double.js', import.meta.url)), 'hang',
        ] : args, { stdio: 'pipe', windowsHide: true });
        first = false;
        child.stdout.once('data', ready.resolve);
        return child;
      },
    } });
    const client = request(url, { method: 'POST', headers: {
      'Content-Type': 'application/octet-stream',
    } });
    client.on('error', () => {});
    const reply = once(client, 'response');
    // An aborted request has no response.
    void reply.catch(() => {});
    client.end('input');
    await ready.promise;
    assert.ok(child);
    const closed = once(child, 'close');
    if (mode !== 'timeout') {
      if (mode === 'shutdown') shutdown.abort();
      else client.destroy();
      await closed;
    } else {
      const [response] = await reply;
      assert.equal(response.statusCode, 503);
      response.resume();
      await once(response, 'end');
    }
    await nextTurn();
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    if (mode !== 'shutdown') {
      const result = await post(url, Buffer.from([255, 216, 255, 0]));
      assert.equal(result.status, 422);
    }
  }
});

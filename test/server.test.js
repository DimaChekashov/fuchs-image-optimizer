import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import test from 'node:test';
import { createAppServer } from '../src/server.js';
import { startApplication } from '../src/main.js';

test('server factory is unbound and routes enforce the HTTP contract', async (t) => {
  const server = createAppServer();
  assert.equal(server.listening, false);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;

  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await page.text(), /<html lang="ru">/);
  for (const [path, type] of [
    ['/app.js', 'text/javascript'], ['/styles.css', 'text/css'],
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(type));
    assert.ok((await response.text()).length > 0);
  }

  for (const { path, method, status, code } of [
    { path: '/missing', method: 'GET', status: 404, code: 'NOT_FOUND' },
    { path: '/', method: 'POST', status: 405, code: 'METHOD_NOT_ALLOWED' },
  ]) {
    const response = await fetch(url + path, { method });
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
    assert.deepEqual(await response.json(), {
      error: {
        code,
        message: code === 'NOT_FOUND'
          ? 'Ресурс не найден.' : 'Метод запроса не поддерживается.',
      },
    });
    if (status === 405) {
      assert.equal(response.headers.get('allow'), 'GET');
    }
  }

  await new Promise((resolve, reject) => {
    const client = request(url, { headers: { host: 'example.com' } }, (response) => {
      assert.equal(response.statusCode, 403);
      response.resume();
      response.once('end', resolve);
      response.once('error', reject);
    });
    client.once('error', reject);
    client.end();
  });
});

test('startup opens the listening URL once and survives browser failure', async (t) => {
  t.mock.method(console, 'log', () => {});
  const warning = t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const { server, url } = await startApplication(async (address) => {
    calls += 1;
    const response = await fetch(address);
    assert.equal(response.status, 200);
    await response.text();
    throw new Error('Browser unavailable');
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(calls, 1);
  assert.equal(warning.mock.callCount(), 1);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  await response.text();
});

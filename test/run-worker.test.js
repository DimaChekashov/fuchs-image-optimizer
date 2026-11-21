import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import { runWorker } from '../src/run-worker.js';
import { AppError } from '../src/errors.js';

/** @type {import('../src/options.js').CompressionOptions} */
const options = { format: 'webp', quality: 80 };

test('real worker returns a complete image and expected image errors', async () => {
  const input = await sharp({
    create: { width: 3, height: 2, channels: 3, background: '#336699' },
  }).png().toBuffer();
  const output = await runWorker(input, options);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 3);
  await sharp(output).raw().toBuffer();
  await assert.rejects(runWorker(Buffer.from([255, 216, 255, 0]), options),
    (error) => error instanceof AppError && error.code === 'INVALID_IMAGE');
});

test('failures discard partial output and wait for process closure', async (t) => {
  for (const scenario of ['timeout', 'abort', 'overflow', 'stderr', 'crash', 'unknown']) {
    await t.test(scenario, async (t) => {
      const controller = new AbortController();
      if (scenario === 'timeout') {
        t.mock.timers.enable({ apis: ['setTimeout'] });
      }
      /** @type {import('node:child_process').ChildProcessWithoutNullStreams | undefined} */
      let child;
      const result = runWorker(Buffer.from('input'), options, {
        signal: controller.signal,
        maxOutputBytes: 64,
        createProcess: () => {
          const mode = ['timeout', 'abort'].includes(scenario) ? 'hang' : scenario;
          child = spawn(process.execPath, [
            fileURLToPath(new URL('./helpers/worker-double.js', import.meta.url)), mode,
          ], { stdio: 'pipe', windowsHide: true });
          child.stdout.once('data', () => {
            if (scenario === 'timeout') t.mock.timers.tick(30_000);
            if (scenario === 'abort') controller.abort();
          });
          return child;
        },
      });
      const expectedCode = scenario === 'timeout' ? 'PROCESSING_TIMEOUT'
        : scenario === 'overflow' ? 'OUTPUT_TOO_LARGE' : 'INTERNAL_ERROR';
      await assert.rejects(result, (error) => scenario === 'abort'
        ? error instanceof Error && error.name === 'AbortError'
        : error instanceof AppError && error.code === expectedCode);
      assert.ok(child);
      assert.ok(child.exitCode !== null || child.signalCode !== null);
      assert.equal(child.stdout.destroyed, true);
      assert.equal(child.stderr.destroyed, true);
      assert.equal(controller.signal.aborted, scenario === 'abort');
      const next = await runWorker(Buffer.alloc(0), options, {
        createProcess: () => spawn(process.execPath, [
          fileURLToPath(new URL('./helpers/worker-double.js', import.meta.url)), 'success',
        ], { stdio: 'pipe', windowsHide: true }),
      });
      assert.equal(next.toString(), 'complete');
    });
  }
});

test('pre-cancelled work never spawns a process', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runWorker(Buffer.alloc(0), options, {
    signal: controller.signal,
    createProcess: () => { throw new Error('Must not spawn'); },
  }), { name: 'AbortError' });
});

test('spawn failure becomes INTERNAL_ERROR', async () => {
  await assert.rejects(runWorker(Buffer.alloc(0), options, {
    createProcess: () => { throw new Error('Cannot spawn'); },
  }), (error) => error instanceof AppError && error.code === 'INTERNAL_ERROR');
  await assert.rejects(runWorker(Buffer.alloc(0), options, {
    createProcess: () => spawn(
      fileURLToPath(new URL('./missing-executable', import.meta.url)),
      [], { stdio: 'pipe', windowsHide: true },
    ),
  }), (error) => error instanceof AppError && error.code === 'INTERNAL_ERROR');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOptions } from '../src/options.js';
import { AppError } from '../src/errors.js';

test('default settings for each supported codec', () => {
  assert.deepEqual(parseOptions(new URLSearchParams('format=jpeg')), {
    format: 'jpeg', quality: 80,
  });
  assert.deepEqual(parseOptions(new URLSearchParams('format=webp')), {
    format: 'webp', quality: 80,
  });
  assert.deepEqual(parseOptions(new URLSearchParams('format=png')), {
    format: 'png', compressionLevel: 6,
  });
});

test('explicit settings, bounds and decimal digits', () => {
  for (const format of ['jpeg', 'webp']) {
    for (const quality of [1, 75, 100]) {
      assert.deepEqual(
        parseOptions(new URLSearchParams({ format, quality: String(quality) })),
        { format, quality },
      );
    }
  }
  for (const compressionLevel of [0, 4, 9]) {
    assert.deepEqual(
      parseOptions(new URLSearchParams({
        format: 'png', compressionLevel: String(compressionLevel),
      })),
      { format: 'png', compressionLevel },
    );
  }
  assert.deepEqual(parseOptions(new URLSearchParams('format=webp&quality=080')), {
    format: 'webp', quality: 80,
  });
});

test('invalid queries fail with the public error contract', () => {
  const queries = [
    '', 'quality=80', 'format=', 'format=gif', 'format=JPEG',
    'format=png&quality=80', 'format=jpeg&compressionLevel=6',
    'format=webp&compressionLevel=0', 'format=png&unknown=1',
    'format=webp&format=webp', 'format=webp&format=png',
    'format=webp&quality=80&quality=80',
    'format=png&compressionLevel=6&compressionLevel=7',
    'format=webp&quality=', 'format=png&compressionLevel=',
  ];
  for (const value of ['0', '101', '-1', '1.5', 'NaN', 'Infinity',
    '1e2', '0x50', '+80', ' 80', '80 ', '9007199254740993']) {
    queries.push(`format=webp&quality=${encodeURIComponent(value)}`);
  }
  for (const value of ['-1', '10', '1.5', 'abc']) {
    queries.push(`format=png&compressionLevel=${value}`);
  }
  for (const query of queries) {
    assert.throws(
      () => parseOptions(new URLSearchParams(query)),
      (error) => error instanceof AppError
        && error.code === 'INVALID_OPTIONS'
        && error.status === 400
        && error.message.length > 0,
      query,
    );
  }
});

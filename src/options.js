import { AppError } from './errors.js';

/**
 * @typedef {{format: 'jpeg' | 'webp', quality: number} |
 * {format: 'png', compressionLevel: number}} CompressionOptions
 */

/**
 * @param {URLSearchParams} params Query parameters, including duplicate keys.
 * @returns {CompressionOptions} Validated codec options.
 * @throws {AppError} When the query violates the compression contract.
 */
export function parseOptions(params) {
  const seen = new Set();
  for (const key of params.keys()) {
    if (seen.has(key) || !['format', 'quality', 'compressionLevel'].includes(key)) {
      throw new AppError('INVALID_OPTIONS');
    }
    seen.add(key);
  }

  const format = params.get('format');
  if (format === 'png') {
    if (params.has('quality')) {
      throw new AppError('INVALID_OPTIONS');
    }
    return {
      format,
      compressionLevel: parseInteger(params.get('compressionLevel'), 6, 0, 9),
    };
  }
  if (format === 'jpeg' || format === 'webp') {
    if (params.has('compressionLevel')) {
      throw new AppError('INVALID_OPTIONS');
    }
    return { format, quality: parseInteger(params.get('quality'), 80, 1, 100) };
  }
  throw new AppError('INVALID_OPTIONS');
}

/**
 * @param {string | null} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function parseInteger(value, fallback, minimum, maximum) {
  if (value === null) {
    return fallback;
  }
  const number = Number(value);
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(number)
    || number < minimum || number > maximum) {
    throw new AppError('INVALID_OPTIONS');
  }
  return number;
}

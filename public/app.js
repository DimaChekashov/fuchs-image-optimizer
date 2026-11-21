const form = document.querySelector('#optimizer');
const settings = document.querySelector('#settings');
const fileInput = document.querySelector('#file');
const format = document.querySelector('#format');
const quality = document.querySelector('#quality');
const compression = document.querySelector('#compression');
const qualityValue = document.querySelector('#quality-value');
const compressionValue = document.querySelector('#compression-value');
const qualityField = document.querySelector('#quality-field');
const compressionField = document.querySelector('#compression-field');
const jpegNote = document.querySelector('#jpeg-note');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const before = document.querySelector('#before');
const after = document.querySelector('#after');
const difference = document.querySelector('#difference');
const download = document.querySelector('#download');

if (!(form instanceof HTMLFormElement) || !(settings instanceof HTMLFieldSetElement)
  || !(fileInput instanceof HTMLInputElement) || !(format instanceof HTMLSelectElement)
  || !(quality instanceof HTMLInputElement) || !(compression instanceof HTMLInputElement)
  || !(qualityValue instanceof HTMLOutputElement)
  || !(compressionValue instanceof HTMLOutputElement)
  || !(qualityField instanceof HTMLElement) || !(compressionField instanceof HTMLElement)
  || !(jpegNote instanceof HTMLElement) || !(status instanceof HTMLElement)
  || !(result instanceof HTMLElement) || !(before instanceof HTMLElement)
  || !(after instanceof HTMLElement) || !(difference instanceof HTMLElement)
  || !(download instanceof HTMLAnchorElement)) {
  throw new Error('The optimizer form is incomplete.');
}

let resultUrl = '';
/** @type {AbortController | undefined} */
let controller;

const clearResult = () => {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = '';
  download.removeAttribute('href');
  result.hidden = true;
};

form.addEventListener('input', () => {
  qualityValue.value = quality.value;
  compressionValue.value = compression.value;
  qualityField.hidden = format.value === 'png';
  compressionField.hidden = format.value !== 'png';
  jpegNote.hidden = format.value !== 'jpeg';
  clearResult();
  status.dataset.error = 'false';
  status.textContent = 'Настройки готовы. Нажмите «Сжать изображение».';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controller) return;
  const file = fileInput.files?.[0];
  if (!file) return;
  clearResult();
  settings.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.dataset.error = 'false';
  status.textContent = 'Обрабатываем изображение…';
  controller = new AbortController();
  const outputFormat = format.value;
  const params = new URLSearchParams({ format: outputFormat });
  if (outputFormat === 'png') params.set('compressionLevel', compression.value);
  else params.set('quality', quality.value);
  try {
    const response = await fetch(`/api/optimize?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal: controller.signal,
    });
    if (!response.ok) {
      /** @type {unknown} */
      const payload = await response.json();
      throw new Error(errorMessage(payload));
    }
    const blob = await response.blob();
    resultUrl = URL.createObjectURL(blob);
    before.textContent = formatBytes(file.size);
    after.textContent = formatBytes(blob.size);
    const percent = file.size === 0 ? 0 : Math.abs(blob.size - file.size) / file.size * 100;
    difference.textContent = blob.size > file.size
      ? `Размер увеличился на ${percent.toFixed(1)}%. Результат доступен для скачивания.`
      : `Размер уменьшился на ${percent.toFixed(1)}%.`;
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
    download.download = `${baseName}-optimized.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`;
    download.href = resultUrl;
    result.hidden = false;
    status.textContent = 'Готово. Скачайте обработанное изображение.';
  } catch (error) {
    status.dataset.error = 'true';
    status.textContent = error instanceof Error
      ? error.message : 'Не удалось обработать изображение. Повторите попытку.';
  } finally {
    controller = undefined;
    settings.disabled = false;
    form.setAttribute('aria-busy', 'false');
  }
});

window.addEventListener('pagehide', () => {
  controller?.abort();
  clearResult();
});

/** @param {number} bytes @returns {string} */
function formatBytes(bytes) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(bytes / 1_048_576)} МиБ (${bytes.toLocaleString('ru-RU')} байт)`;
}

/** @param {unknown} payload @returns {string} */
function errorMessage(payload) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = payload.error;
    if (error && typeof error === 'object'
      && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
  }
  return 'Не удалось обработать изображение. Повторите попытку.';
}

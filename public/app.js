import { createZip } from './zip.js';

const form = document.querySelector('#optimizer');
const settings = document.querySelector('#settings');
const fileInput = document.querySelector('#file');
const format = document.querySelector('#format');
const quality = document.querySelector('#quality');
const qualityValue = document.querySelector('#quality-value');
const qualityHelp = document.querySelector('#quality-help');
const jpegNote = document.querySelector('#jpeg-note');
const status = document.querySelector('#status');
const images = document.querySelector('#images');
const downloadAll = document.querySelector('#download-all');

if (!(form instanceof HTMLFormElement) || !(settings instanceof HTMLFieldSetElement)
  || !(fileInput instanceof HTMLInputElement) || !(format instanceof HTMLSelectElement)
  || !(quality instanceof HTMLInputElement)
  || !(qualityValue instanceof HTMLOutputElement)
  || !(qualityHelp instanceof HTMLElement)
  || !(jpegNote instanceof HTMLElement) || !(status instanceof HTMLElement)
  || !(images instanceof HTMLUListElement) || !(downloadAll instanceof HTMLButtonElement)) {
  throw new Error('The optimizer form is incomplete.');
}

/** @type {ReturnType<typeof createImageRow>[]} */
let rows = [];
/** @type {AbortController | undefined} */
let controller;
let archiveUrl = '';
let archiveBusy = false;

const clearArchive = () => {
  if (archiveUrl) URL.revokeObjectURL(archiveUrl);
  archiveUrl = '';
  downloadAll.disabled = true;
};

/**
 * @param {File} file
 * @returns {{file: File, element: HTMLLIElement, previewUrl: string, resultUrl: string,
 * resultBlob: Blob | null, resultPreview: HTMLImageElement, state: HTMLParagraphElement,
 * sizes: HTMLParagraphElement, download: HTMLAnchorElement}}
 */
function createImageRow(file) {
  const element = document.createElement('li');
  element.className = 'image-row';
  const preview = document.createElement('img');
  preview.className = 'thumbnail';
  preview.alt = `Предпросмотр ${file.name}`;
  const previewUrl = URL.createObjectURL(file);
  const previewError = document.createElement('p');
  previewError.className = 'hint';
  previewError.hidden = true;
  previewError.textContent = 'Предпросмотр недоступен.';
  preview.addEventListener('error', () => {
    preview.hidden = true;
    previewError.hidden = false;
  }, { once: true });
  preview.src = previewUrl;
  const name = document.createElement('h3');
  name.textContent = file.name;
  const state = document.createElement('p');
  state.className = 'image-state';
  state.textContent = 'Ожидает обработки.';
  const sizes = document.createElement('p');
  sizes.className = 'hint';
  sizes.textContent = `Исходный размер — ${formatBytes(file.size)}`;
  const download = document.createElement('a');
  download.className = 'download';
  download.textContent = 'Скачать изображение';
  download.hidden = true;
  const source = document.createElement('div');
  const sourceLabel = document.createElement('p');
  sourceLabel.textContent = 'Исходник';
  source.append(sourceLabel, preview, previewError);
  const output = document.createElement('div');
  const outputLabel = document.createElement('p');
  outputLabel.textContent = 'После сжатия';
  const resultPreview = document.createElement('img');
  resultPreview.className = 'thumbnail result-thumbnail';
  resultPreview.alt = `После сжатия ${file.name}`;
  resultPreview.hidden = true;
  output.append(outputLabel, resultPreview, state, sizes, download);
  const comparison = document.createElement('div');
  comparison.className = 'comparison';
  comparison.append(source, output);
  element.append(name, comparison);
  /** @type {Blob | null} */
  const resultBlob = null;
  return { file, element, previewUrl, resultUrl: '', resultBlob, resultPreview, state, sizes, download };
}

const clearRows = () => {
  clearArchive();
  for (const row of rows) {
    URL.revokeObjectURL(row.previewUrl);
    if (row.resultUrl) URL.revokeObjectURL(row.resultUrl);
  }
  rows = [];
  images.replaceChildren();
};
const showSelection = () => {
  clearRows();
  rows = Array.from(fileInput.files ?? [], createImageRow);
  images.append(...rows.map((row) => row.element));
  status.textContent = `Выбрано изображений — ${rows.length}. Настройте сжатие и запустите обработку.`;
};
fileInput.addEventListener('change', showSelection);
form.addEventListener('input', () => {
  qualityValue.value = quality.value;
  qualityHelp.textContent = format.value === 'png'
    ? 'PNG сжимается без потерь. Меньше значение — интенсивнее сжатие.'
    : 'Меньше значение — меньше размер и детализация.';
  jpegNote.hidden = format.value !== 'jpeg';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (controller || archiveBusy || rows.length === 0) return;
  clearArchive();
  const batchController = new AbortController();
  controller = batchController;
  settings.disabled = true;
  form.setAttribute('aria-busy', 'true');
  const outputFormat = format.value;
  const params = new URLSearchParams({ format: outputFormat });
  const selectedQuality = quality.valueAsNumber;
  if (outputFormat === 'png') {
    params.set('compressionLevel', String(Math.round(9 * (100 - selectedQuality) / 100)));
  } else {
    params.set('quality', String(Math.max(1, selectedQuality)));
  }
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.resultUrl) URL.revokeObjectURL(row.resultUrl);
    row.resultUrl = '';
    row.resultBlob = null;
    row.resultPreview.hidden = true;
    row.resultPreview.removeAttribute('src');
    row.download.removeAttribute('href');
    row.download.hidden = true;
    row.state.dataset.error = 'false';
    row.state.textContent = 'Ожидает обработки.';
    row.sizes.textContent = `Исходный размер — ${formatBytes(row.file.size)}`;
  }
  try {
    for (const row of rows) {
      if (batchController.signal.aborted) break;
      status.textContent = `Обрабатываем изображение ${completed + failed + 1} из ${rows.length}…`;
      row.state.textContent = 'Обрабатывается…';
      try {
        const response = await fetch(`/api/optimize?${params}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: row.file,
          signal: batchController.signal,
        });
        if (!response.ok) {
          /** @type {unknown} */
          const payload = await response.json();
          throw new Error(errorMessage(payload));
        }
        const blob = await response.blob();
        if (batchController.signal.aborted) break;
        row.resultUrl = URL.createObjectURL(blob);
        row.resultBlob = blob;
        row.resultPreview.src = row.resultUrl;
        row.resultPreview.hidden = false;
        row.sizes.textContent = `Исходный размер — ${formatBytes(row.file.size)}. После обработки — ${formatBytes(blob.size)}.`;
        const percent = row.file.size === 0 ? 0
          : Math.abs(blob.size - row.file.size) / row.file.size * 100;
        row.state.textContent = blob.size > row.file.size
          ? `Размер увеличился на ${percent.toFixed(1)}%. Результат доступен для скачивания.`
          : `Размер уменьшился на ${percent.toFixed(1)}%.`;
        const baseName = row.file.name.replace(/\.[^.]+$/, '') || 'image';
        row.download.download = `${baseName}-optimized.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`;
        row.download.href = row.resultUrl;
        row.download.hidden = false;
        completed += 1;
      } catch (error) {
        if (batchController.signal.aborted) break;
        row.state.dataset.error = 'true';
        row.state.textContent = error instanceof Error
          ? error.message : 'Не удалось обработать изображение.';
        failed += 1;
      }
    }
    status.textContent = `Обработка завершена. Готово — ${completed}, ошибок — ${failed}.`;
  } finally {
    controller = undefined;
    settings.disabled = false;
    form.setAttribute('aria-busy', 'false');
    downloadAll.disabled = !rows.some((row) => row.resultBlob);
  }
});

downloadAll.addEventListener('click', async () => {
  if (archiveBusy || controller) return;
  const selection = rows;
  archiveBusy = true;
  settings.disabled = true;
  downloadAll.disabled = true;
  try {
    if (!archiveUrl) {
      const files = [];
      for (const row of selection) {
        if (row.resultBlob) files.push({ name: row.download.download, blob: row.resultBlob });
      }
      if (files.length === 0) return;
      const archive = await createZip(files);
      if (rows !== selection) return;
      archiveUrl = URL.createObjectURL(archive);
    }
    const link = document.createElement('a');
    link.href = archiveUrl;
    link.download = 'fuchs-optimized.zip';
    link.click();
  } catch {
    status.textContent = 'Не удалось создать ZIP. Можно скачать изображения по отдельности.';
  } finally {
    archiveBusy = false;
    settings.disabled = false;
    downloadAll.disabled = !rows.some((row) => row.resultBlob);
  }
});
window.addEventListener('pagehide', () => {
  controller?.abort();
  clearRows();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) showSelection();
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

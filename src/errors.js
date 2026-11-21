export const ERROR_DEFINITIONS = Object.freeze({
  EMPTY_INPUT: { status: 400, message: 'Выберите непустой файл.' },
  INVALID_OPTIONS: { status: 400, message: 'Некорректные настройки сжатия.' },
  FORBIDDEN_ORIGIN: { status: 403, message: 'Доступ с этого адреса запрещён.' },
  NOT_FOUND: { status: 404, message: 'Ресурс не найден.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Метод запроса не поддерживается.' },
  UPLOAD_TIMEOUT: { status: 408, message: 'Истекло время загрузки файла.' },
  INPUT_TOO_LARGE: { status: 413, message: 'Превышен допустимый размер файла.' },
  PIXEL_LIMIT: { status: 413, message: 'Превышено допустимое число пикселей.' },
  OUTPUT_TOO_LARGE: { status: 413, message: 'Превышен допустимый размер результата.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Неподдерживаемый тип тела запроса.' },
  UNSUPPORTED_FORMAT: { status: 415, message: 'Формат или анимация не поддерживаются.' },
  INVALID_IMAGE: { status: 422, message: 'Не удалось прочитать изображение.' },
  BUSY: { status: 429, message: 'Уже обрабатывается другой файл. Повторите попытку.' },
  PROCESSING_TIMEOUT: { status: 503, message: 'Истекло время обработки изображения.' },
  INTERNAL_ERROR: { status: 500, message: 'Не удалось выполнить обработку.' },
});

/** @typedef {keyof typeof ERROR_DEFINITIONS} ErrorCode */

export class AppError extends Error {
  /**
   * @param {ErrorCode} code Stable public error code.
   */
  constructor(code) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = 'AppError';
    this.code = code;
    this.status = definition.status;
  }
}

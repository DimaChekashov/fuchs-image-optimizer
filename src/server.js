import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AppError } from './errors.js';

/**
 * Creates an unbound local HTTP server.
 * @returns {import('node:http').Server}
 */
export function createAppServer() {
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error('HTTP request failed', error);
      if (!response.destroyed && !response.headersSent) {
        sendError(response, new AppError('INTERNAL_ERROR'));
      } else {
        response.destroy();
      }
    });
  });
  return server;
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @returns {Promise<void>}
 */
async function handleRequest(request, response) {
  const expectedHost = `127.0.0.1:${request.socket.localPort}`;
  if (request.headers.host !== expectedHost) {
    sendError(response, new AppError('FORBIDDEN_ORIGIN'));
    return;
  }
  const pathname = request.url?.split('?')[0];
  if (pathname !== '/') {
    sendError(response, new AppError('NOT_FOUND'));
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendError(response, new AppError('METHOD_NOT_ALLOWED'));
    return;
  }
  const html = await readFile(new URL('../public/index.html', import.meta.url));
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': html.length,
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {AppError} error
 * @returns {void}
 */
function sendError(response, error) {
  response.writeHead(error.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'close',
  });
  response.end(JSON.stringify({
    error: { code: error.code, message: error.message },
  }));
}

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AppError } from './errors.js';
import { createOptimizeRoute, sendError } from './optimize-route.js';

/**
 * Creates an unbound local HTTP server.
 * @param {import('./optimize-route.js').OptimizeSettings} [settings]
 * @returns {import('node:http').Server}
 */
export function createAppServer(settings = {}) {
  const optimize = createOptimizeRoute(settings);
  const server = createServer((request, response) => {
    void handleRequest(request, response, optimize).catch((error) => {
      if (!response.destroyed && !response.headersSent) {
        sendError(response, error);
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
 * @param {ReturnType<typeof createOptimizeRoute>} optimize
 * @returns {Promise<void>}
 */
async function handleRequest(request, response, optimize) {
  const expectedHost = `127.0.0.1:${request.socket.localPort}`;
  if (request.headers.host !== expectedHost) {
    sendError(response, new AppError('FORBIDDEN_ORIGIN'));
    return;
  }
  const pathname = request.url?.split('?')[0];
  if (pathname === '/api/optimize') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    await optimize(request, response);
    return;
  }
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


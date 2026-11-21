import { once } from 'node:events';
import open from 'open';
import { createAppServer } from './server.js';

/**
 * Starts the local server and opens its URL once it is listening.
 * @param {(url: string) => Promise<unknown>} openBrowser
 * @returns {Promise<{server: import('node:http').Server, url: string}>}
 */
export async function startApplication(openBrowser = open) {
  const server = createAppServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Local server address is unavailable.');
  }
  const url = `http://127.0.0.1:${address.port}/`;
  console.log(url);
  try {
    await openBrowser(url);
  } catch (error) {
    console.warn('Не удалось открыть браузер. Откройте адрес вручную.', error);
  }
  return { server, url };
}

if (import.meta.main) {
  try {
    const { server } = await startApplication();
    const stop = () => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      server.close();
      server.closeAllConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error('Не удалось запустить приложение.', error);
    process.exitCode = 1;
  }
}

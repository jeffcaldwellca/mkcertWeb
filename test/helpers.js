// Shared test helpers for the node:test suite
const express = require('express');

/**
 * Mount a router (or middleware) in a throwaway express app listening on an
 * ephemeral port. Returns { url, close } — call close() in afterEach/finally.
 */
async function startApp(setup) {
  const app = express();
  app.use(express.json());
  setup(app);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

module.exports = { startApp };

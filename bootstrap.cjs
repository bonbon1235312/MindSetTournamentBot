const path = require('node:path');
const { pathToFileURL } = require('node:url');

const prefix = '[MindSet boot]';

console.log(`${prefix} launcher started (Node ${process.version}, cwd=${process.cwd()})`);

process.on('uncaughtException', (error) => {
  console.error(`${prefix} uncaught exception:`, error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(`${prefix} unhandled rejection:`, reason);
  process.exit(1);
});

async function launch() {
  console.log(`${prefix} registering TypeScript ESM loader...`);

  const { register } = await import('node:module');
  register('ts-node/esm/transpile-only', pathToFileURL(__filename).href);

  const entrypoint = pathToFileURL(path.join(__dirname, 'src', 'main.ts')).href;
  console.log(`${prefix} loading ${entrypoint}...`);
  await import(entrypoint);
}

launch().catch((error) => {
  console.error(`${prefix} launcher failed:`, error);
  process.exit(1);
});

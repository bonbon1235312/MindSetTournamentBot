const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dns = require('node:dns');

const prefix = '[MindSet boot]';

// Force IPv4-first DNS resolution. Node's default is 'verbatim', which on
// Linux hosts commonly returns an IPv6 (AAAA) address first. Many VPS /
// Docker environments (this Pterodactyl container included, symptomatically)
// have an IPv6 address assigned but no working IPv6 route to the internet —
// so a connection to Discord's gateway over IPv6 black-holes and hangs until
// timeout, even though IPv4 would connect instantly. This is why the exact
// same code + token connects in <1s locally (Windows, working IPv6/IPv4) but
// hangs for 30s here. Discord fully supports IPv4, so preferring it is safe
// everywhere and a no-op on hosts whose IPv6 works.
dns.setDefaultResultOrder('ipv4first');

console.log(`${prefix} launcher started (Node ${process.version}, cwd=${process.cwd()}, dns=ipv4first)`);

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

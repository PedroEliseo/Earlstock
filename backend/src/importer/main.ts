import { main } from './cli.js';

// Entry point of `npm run import` (and of dist/importer/main.js in a build).
process.exitCode = await main(process.argv.slice(2));

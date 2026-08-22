#!/usr/bin/env node

import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch((error) => {
  console.error(`\n\x1b[31m✕\x1b[0m ${error.message}`);
  process.exitCode = 1;
});

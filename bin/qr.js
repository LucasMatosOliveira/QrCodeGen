#!/usr/bin/env node
import { run } from '../src/cli.js';

run(process.argv.slice(2)).catch((err) => {
  console.error(`\x1b[31mErro:\x1b[0m ${err.message}`);
  process.exit(1);
});

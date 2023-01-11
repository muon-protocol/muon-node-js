#!/usr/bin/env node

import * as mod1 from'./modules/cmd-conf-mod.js';
import * as mod2 from'./modules/cmd-app-mod.js';

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const yargs = require('yargs');

yargs
  //@ts-ignore
  .command(mod1)
  .command(mod2)
  .demandCommand()
  .help();

yargs
//@ts-ignore
  .parse()
  .then(() => {
    process.exit(0)
  })

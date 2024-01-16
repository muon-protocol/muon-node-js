#!/usr/bin/env node

import * as mod1 from'./modules/cmd-conf-mod.js';
import * as mod2 from'./modules/cmd-app-mod.js';
import * as mod3 from'./modules/cmd-keys-mod.js';
import * as mod4 from'./modules/cmd-admin-mod.js';

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const yargs = require('yargs');

yargs
  //@ts-ignore
  .command(mod1)
  .command(mod2)
  .command(mod3)
  .command(mod4)
  .demandCommand()
  .help();

yargs
//@ts-ignore
  .parse()
  .then(() => {
    process.exit(0)
  })


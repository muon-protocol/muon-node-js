#!/usr/bin/env node

const yargs = require('yargs')

yargs.command(require('./modules/cmd-tss-mod'))
  .demandCommand()
  .help();

yargs.parse()

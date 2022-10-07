#!/usr/bin/env node

const yargs = require('yargs')

yargs
  .command(require('./modules/cmd-conf-mod'))
  .command(require('./modules/cmd-app-mod'))
  .demandCommand()
  .help();

yargs
  .parse()
  .then(() => {
    process.exit(0)
  })

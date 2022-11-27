const Log = require('debug')

function makeLog(title) {
  let log = Log(title)
  log.log = console.log.bind(console);
  return log
}

module.exports = makeLog;

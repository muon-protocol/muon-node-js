import debug from 'debug'

function makeLog(title) {
  let log = debug(title)
  log.log = console.log.bind(console);
  return log
}

export default makeLog;

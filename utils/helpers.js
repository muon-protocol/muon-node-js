
module.exports.timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports.getTimestamp = () => Math.floor(Date.now() / 1000);
module.exports.newCallId = () => {
  return Date.now().toString(32) + Math.floor(Math.random()*999999).toString(32);
}

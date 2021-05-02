
module.exports.timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports.getTimestamp = () => Math.floor(Date.now() / 1000);

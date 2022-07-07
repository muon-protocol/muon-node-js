const { newCallId } = require('@src/utils/helpers');

module.exports = class ApplicationCall {
  id
  constructor() {
    this.id = newCallId();
  }
}

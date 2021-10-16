/**
 * This is sample plugin that acts like a simple app.
 * @type {BaseTssAppPlugin}
 */

const BaseApp = require('./base/base-tss-app-plugin')

class TestPlugin extends BaseApp {
  APP_NAME = 'test'

  async onRequest(request){
    let {method, data: {params}} = request;
    switch (method) {
      case "sign":
        return 1 + Math.random()
      default:
        return "test done"
    }
  }

  hashRequestResult(request, result){
    return Math.floor(result).toString();
  }
}

module.exports = TestPlugin;

const Events = require('events-async')

module.exports = class BasePlugin extends Events{
  muon = null;

  constructor(muon, config){
    super()
    this.muon = muon
  }

  /**
   * This method will call immediately after Muon start.
   * @returns {Promise<void>}
   */
  async onStart(){
  }
}

/**
 * A Promise that will reject, if not resolved after [timeout] ms.
 * @param timeout
 * @param timeoutMessage
 * @param {Object} options - options of promise
 * @param {Boolean} options.resolveOnTimeout - if true promise will resolve null after timeout, instead of reject.
 * @constructor
 */
function TimeoutPromise(timeout, timeoutMessage, options={}) {
  var self = this;
  this.isFullFilled = false;
  this.options = options;
  this.promise = new Promise(function(resolve, reject) {
    self._reject = reject
    self._resolve = resolve
  })
  this.resolve = function resolve() {
    this.isFullFilled = true;
    this._resolve(...arguments)
  }
  this.reject = function () {
    this.isFullFilled = true;
    if(this.options.resolveOnTimeout)
      this._resolve(null)
    else
      this._reject(...arguments)
  }

  this.waitToFulfill = function(){
    return this.promise;
  }

  if(timeout) {
    setTimeout(() => {
      if(!self.isFullFilled) {
        self.reject({message: timeoutMessage || 'Promise timed out'})
      }
    }, timeout)
  }
}

module.exports = TimeoutPromise;

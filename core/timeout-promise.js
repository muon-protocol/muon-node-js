function TimeoutPromise(timeout, timeoutMessage) {
  var self = this;
  this.isFullFilled = false;
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
    this._reject(...arguments)
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

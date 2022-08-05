/**
 * A Promise that will reject, if not resolved after [timeout] ms.
 * @param timeout
 * @param timeoutMessage
 * @param {Object} options - options of promise
 * @param {Boolean} options.resolveOnTimeout - if true promise will resolve null after timeout, instead of reject.
 * @param {function | undefined} options.onTimeoutResult - if promise timed out, output of this method will return instead of null.
 * @param {any | undefined} options.data - if promise timed out, id will pass to onTimeoutResult.
 * @constructor
 */
export type TimeoutPromiseOptions = {
  resolveOnTimeout?: boolean,
  onTimeoutResult?: ((defaultValue: any) => void) | null
  defaultResult?: any,
}

export default class TimeoutPromise {
  isFulfilled: boolean = false;
  timeout: number = 0
  timeoutMessage: string = "Promise timed out"
  options: TimeoutPromiseOptions = {}
  promise: Promise<any>;
  _resolve: (value:any) => void
  _reject: (reason:any) => void

  constructor(timeout?: number, timeoutMessage?: string, options: TimeoutPromiseOptions={}){
    if(timeout)
      this.timeout = timeout
    if(timeoutMessage)
      this.timeoutMessage = timeoutMessage
    this.options = {
      resolveOnTimeout: false,
      onTimeoutResult: null,
      defaultResult: null,
      ...options
    }
    this.promise = new Promise((resolve, reject) => {
      this._reject = reject
      this._resolve = resolve
    })

    if(timeout) {
      setTimeout(this.onTimedOut.bind(this), timeout);
    }
  }

  resolve(value: any) {
    this.isFulfilled = true
    this._resolve(value);
  }

  reject(reason: any) {
    this.isFulfilled = true;
    if(this.options.resolveOnTimeout) {
      if(this.options.onTimeoutResult)
        this._resolve(this.options.onTimeoutResult(this.options.defaultResult))
      else
        this._resolve(null)
    } else
      this._reject(reason)
  }

  waitToFulfill() {
    return this.promise;
  }

  onTimedOut() {
    if (!this.isFulfilled) {
      this.reject({message: this.timeoutMessage})
    }
  }
}

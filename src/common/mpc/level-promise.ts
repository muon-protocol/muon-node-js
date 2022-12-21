
export default class LevelPromise {
  private fulfilledIndex: number;
  timeout: number = 0
  timeoutMessage: string;
  readonly count: number;
  private readonly promises: Array<Promise<any>>;
  private _resolve: Array<(value:any) => void>
  private _reject: Array<(reason:any) => void>


  constructor(count: number, timeout?: number, timeoutMessage?: string) {
    if(timeout)
      this.timeout = timeout
    if(timeoutMessage)
      this.timeoutMessage = timeoutMessage

    this.count = count
    this.fulfilledIndex = -1;
    this._reject = []
    this._resolve = []

    this.promises = new Array(count)
      .fill(0)
      .map((v, i) => {
        return new Promise((resolve, reject) => {
          this._reject.push(reject)
          this._resolve.push(resolve)
        })
      })
    // for(let i=0 ; i<this.count-1 ; i++) {
    //   //@t-s-ignore
    //   this.promises[i].then(() => this.promises[i+1])
    // }

    if(timeout) {
      setTimeout(this.onTimedOut.bind(this), timeout);
    }
  }

  resolve(level, value: any) {
    if(level>0 && this.fulfilledIndex !== level-1)
      throw `Previous level not resolved`;

    this.fulfilledIndex = level
    this._resolve[level](value);
  }

  reject(reason: any) {
    if(this.fulfilledIndex < this.count-1) {
      this._reject[this.fulfilledIndex + 1](reason);
      this.fulfilledIndex = this.count - 1;
    }
  }

  private onTimedOut() {
    if (this.fulfilledIndex < this.count-1) {
      this.reject({message: this.timeoutMessage || `LevelPromise timed out at level [${this.fulfilledIndex+1}]`})
    }
  }

  waitToLevelResolve(level: number) {
    return this.promises[level];
  }

  waitToFulFill(): Promise<any> {
    return Promise.all(this.promises)
      .then(result => result[result.length-1])
  }
}

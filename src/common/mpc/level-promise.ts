import {awaitExpression} from "@babel/types";

export default class LevelPromise {
  isFulfilled: boolean[];
  readonly count: number;
  private readonly promises: Array<Promise<any>>;
  private _resolve: Array<(value:any) => void>
  private _reject: Array<(reason:any) => void>


  constructor(count: number) {
    this.count = count
    this.isFulfilled = new Array(count).fill(false);
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
  }

  resolve(level, value: any) {
    if(level>0 && !this.isFulfilled[level-1])
      throw `Previous level not resolved`;

    this.isFulfilled[level] = true
    this._resolve[level](value);
  }

  reject(level, reason: any) {
    if(level>0 && !this.isFulfilled[level-1])
      throw `Previous level not resolved`;

    this.isFulfilled[level] = true;
    for(let i=level ; i<this.count ; i++) {
      this._reject[i](reason);
    }
  }

  waitToLevelResolve(level: number) {
    return this.promises[level];
  }
}

import TimeoutPromise, {TimeoutPromiseOptions} from "./timeout-promise.js";
import {logger} from '@libp2p/logger'

const log = logger("muon:promise-libs")

type Options = {
  timeout?: number,
  timeoutMessage?: string,
} & TimeoutPromiseOptions
/**
 Takes an iterable of promises as input and returns a single Promise.
 This returned promise fulfills when n number of the input's promises fulfill
 */
export function count(n: number, list: Promise<any>[], options:Options={}): Promise<any[]> {
  if(list.length === 0){
    if(options.resolveOnTimeout)
      return Promise.resolve([])
    else
      return Promise.reject(`empty promise list`);
  }

  return (() => {
    const _options: Options = {
      timeout: 0,
      timeoutMessage: `promise timed out after ${options?.timeout} ms`,
      ... options
    }
    let responseList: any[] = new Array(list.length).fill(_options.defaultResult);
    const resultPromise = new TimeoutPromise(
      _options.timeout,
      _options.timeoutMessage,
      {
        resolveOnTimeout: _options.resolveOnTimeout,
        onTimeoutResult: () => {
          return responseList;
        }
      }
    )
    let successCount=0, remaining = n;
    const execTimes = new Array(list.length).fill(-1)
    const startTime = Date.now()
    let finalized = false;
    for(let i=0 ; i<list.length ; i++) {
      list[i]
        .then(result => {
          execTimes[i] = Date.now() - startTime
          responseList[i] = result;
          successCount++;
        })
        .catch(e => {
          // console.log("===========================", e.message)
        })
        .finally(() => {
          --remaining;
          if(successCount >= n) {
            finalized = true;
            log("count exec times %o", execTimes)
            resultPromise.resolve(responseList)
          }

          if(remaining < n-successCount) {
            if(!options.resolveOnTimeout) {
              finalized = true;
              resultPromise.reject(`no enough promise to resolve`)
            }
          }

          if(!finalized && remaining === 0) {
            if(options.resolveOnTimeout) {
              log("count exec times %o", execTimes)
              resultPromise.resolve(responseList)
            }
            else
              resultPromise.reject(`no enough promise to resolve`)
          }
        })
    }
    return resultPromise.promise;
  })()
}

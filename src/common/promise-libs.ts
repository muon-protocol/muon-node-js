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


/**
  * A method that takes an array of promises, a number n and a timeout as arguments
  * and returns a single promise that resolves if n promises resolve within the timeout
  * and rejects if n promises cannot be resolved within the timeout
*/
export function resolveN<T>( n: number, promises: Promise<T>[],resolveAnyway: boolean=false): Promise<(T|undefined)[]> {
  /** Check if the arguments are valid */
  if (!Array.isArray(promises) || promises.length === 0) {
    throw new Error("Invalid promises array");
  }
  if (typeof n !== "number" || n < 1 || n > promises.length) {
    throw new Error("Invalid n value");
  }

  /** Create a counter for resolved and rejected promises */
  let resolved = 0;
  let rejected = 0;
  let finished = 0;

  /** Create an array to store the resolved values */
  let values: T[] = new Array(promises.length).fill(undefined);

  const errors: any[] = new Array(promises.length).fill(undefined);

  /** Create a new promise to return */
  return new Promise((resolve, reject) => {
    /** Loop through the promises array */
    for (let [i, promise] of promises.entries()) {
      /** Handle each promise */
      promise.then((value) => {
          /** If the promise resolves, increment the resolved counter and push the value to the values array */
          resolved++;
          values[i] = value;
          /** If the resolved counter reaches n, clear the timer and resolve the returned promise with the values array */
          if (resolved >= n) {
            resolve(values);
          }
        })
        .catch((error) => {
          if(typeof error === "string")
            error = {message: error}
          errors[i] = error;
            /** If the promise rejects, increment the rejected counter */
            rejected++;
          /**
           If the rejected counter reaches the limit where n promises cannot be resolved, reject the returned promise with an error message
           If resolveAnyway is set, wait to all promise finalize and then resolve.
           */
            if (!resolveAnyway && rejected > promises.length - n) {
              // reject(new Error("Cannot resolve " + n + " promises"));
              reject({
                message: "Cannot resolve " + n + " promises",
                errors: errors.map(e => e.message),
              });
            }
          })
        .finally(() => {
          finished++;
          if(resolveAnyway && finished === promises.length)
            resolve(values);
        })
    }
  });
}

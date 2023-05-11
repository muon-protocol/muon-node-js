import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"

const redis = createClient(redisConfig)
const redisGetset: (...args)=>Promise<any> = promisify(redis.getset).bind(redis);
const redisExpire: (...args)=>Promise<any> = promisify(redis.expire).bind(redis)

redis.on("error", function(error) {
  console.error(`muon.utils.useOneTime error`, error);
});

/**
 * Restrict the use of an item to a single purpose.
 * An item can be reused for the same purpose, but not for different purposes.
 * For example: A distributed key (nonce) can be used repeatedly to sign a single hash,
 * but it will cause an error if you try to sign two different hashes.
 *
 * @param group {string} - For separating key scopes.
 * @param item {string} - Item that we want to use.
 * @param usedFor {string} - Using purpose.
 * @param ttl {number} -  The lifespan of this data in seconds. The data will be erased from memory after this time.
 *                        The default value is 0, which means it will be stored indefinitely.
 *                        Redis has a limit of 2^32 keys, so it needs to remove unnecessary data.
 */
export async function useOneTime(group: "key"|"fee", item: string, usedFor: string, ttl:number=0) {
  if(!usedFor)
    throw `useOneTime error: usedFor param most be valid string`
  const key = `use ${group}:${item}`
  let alreadyUserFor = await redisGetset(key, usedFor);
  if(alreadyUserFor && alreadyUserFor !== usedFor)
    throw `useOneTime error: this key already used for '${alreadyUserFor}'`
  if(ttl && ttl > 0) {
    await redisExpire(key, ttl)
  }
}

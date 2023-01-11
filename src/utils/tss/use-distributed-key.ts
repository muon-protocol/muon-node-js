import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"

const redis = createClient(redisConfig)
const redisGetset: (...args)=>Promise<any> = promisify(redis.getset).bind(redis);

redis.on("error", function(error) {
  console.error(`muon.common.utils.redis error`, error);
});

export default async function useDistributedKey(publicKeyStr: string, usedFor: string) {
  if(!usedFor)
    throw `useDistributedKey error: usedFor param most be valid string`
  let alreadyUserFor = await redisGetset(`use key ${publicKeyStr}`, usedFor);
  if(alreadyUserFor && alreadyUserFor !== usedFor)
    throw `useDistributedKey error: this key already used for '${alreadyUserFor}'`
}

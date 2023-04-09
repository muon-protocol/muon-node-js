import { createClient, RedisClient } from 'redis'
import redisConfig from '../../common/redis-config.js'
import { promisify } from "util"

const redis = createClient(redisConfig)
const redisGetset: (...args)=>Promise<any> = promisify(redis.getset).bind(redis);

redis.on("error", function(error) {
  console.error(`muon.utils.useOneTime error`, error);
});

export async function useOneTime(group: string, item: string, usedFor: string) {
  if(!usedFor)
    throw `useOneTime error: usedFor param most be valid string`
  let alreadyUserFor = await redisGetset(`use ${group}:${item}`, usedFor);
  if(alreadyUserFor && alreadyUserFor !== usedFor)
    throw `useOneTime error: this key already used for '${alreadyUserFor}'`
}

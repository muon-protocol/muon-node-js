import {createClient, RedisClient} from 'redis'
import redisConfig from '../../common/redis-config.js'
import {promisify} from "util"

const redis = createClient(redisConfig);
const redisGet: (...args) => Promise<any> = promisify(redis.get).bind(redis);
const redisSet: (...args) => Promise<any> = promisify(redis.set).bind(redis);

redis.on("error", function (error) {
  console.error(`muon.utils.useOneTime error`, error);
});

/**
 * Store execution data of a tss generation operation
 * Execution data includes time that took to complete computation of generating the key
 * and logs of networking times between nodes
 */
export async function set(key, val) {
  val = JSON.stringify(val);
  const expireMinutes = 30;
  redisSet(key, val, 'EX', expireMinutes * 60);
}

export async function get(key) {
  let val = await redisGet(key);
  return val;
}

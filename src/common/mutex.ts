import Client, {RedisOptions} from 'ioredis'
import redisConfig from './redis-config.js'
import Redlock, {Lock, Settings} from 'redlock';

const PREFIX = `${process.env.SIGN_WALLET_ADDRESS}`

export class Mutex {
  private readonly client: Client;
  private readonly redlock:Redlock;

  constructor(client?: Client, settings?:Partial<Settings>) {
    if(!client) {
      client = new Client(redisConfig as RedisOptions)
    }
    this.client = client;

    const _settings = {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      ...settings,
    }

    const redlock:Redlock = new Redlock(
      [client],
      _settings
    );

    this.redlock = redlock;
  }

  async lock(resource:string[]|string, ttl:number=1000):Promise<Lock> {
    if(typeof resource === 'string')
      resource = [resource];
    resource = resource.map(r => `${PREFIX}:${r}`);
    return this.redlock.acquire(resource, ttl);
  }
}

import redis from 'redis'

class RedisDependency {
  constructor(prefix){
    this.prefix = prefix;
    let client = redis.createClient({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || 6379
    })

    client.on("error", this.onError);
    this._client = client;
  }

  onError(error) {
    console.error(error);
  }

  set(name, value) {
    return new Promise((resolve, reject) => {
      this._client.set(`${this.prefix}${name}`, value, (err, res) => {
        if(err) {
          reject(err)
        }
        else
          resolve(res)
      })
    })
  }

  get(name) {
    return new Promise((resolve, reject) => {
      this._client.get(`${this.prefix}${name}`, (err, reply) => {
        if(err) {
          // reject(err)
          resolve(null)
        }
        else{
          resolve(reply)
        }
      })
    })
  }
}

function make(app) {
  let prefix = `muon-app-${app.APP_NAME}-`;
  return new RedisDependency(prefix);
}

export default make;

import redis from './redis.js'

const dependencies = {
  redis,
}

function makeAppDependency(app, depName) {
  return dependencies[depName](app)
}

export {
  makeAppDependency,
}

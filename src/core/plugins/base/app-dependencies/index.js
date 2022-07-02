const redis = require('./redis')

const dependencies = {
  redis,
}

function makeAppDependency(app, depName) {
  return dependencies[depName](app)
}

module.exports = {
  makeAppDependency,
}

const axios = require('axios')

function callMuon(req, options={}) {
  let {
    endpoint="http://localhost:8000/v1",
  } = options;

  return axios.post(endpoint, req)
    .then(({data}) => data)
}

module.exports = {
  callMuon,
}

const axios = require('axios')

function callMuon(req) {
  return axios.post("http://localhost:8000/v1", req)
    .then(({data}) => data)
}

module.exports = {
  callMuon,
}

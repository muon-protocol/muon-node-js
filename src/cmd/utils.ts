import axios from 'axios'

export function muonCall(url, request) {
  return axios.post(url, request)
    .then(({data}) => data);
}

import axios from 'axios'
import {timeout} from "../utils/helpers.js";

export function muonCall(url, request) {
  return axios.post(url, request)
    .then(({data}) => data);
}

export async function waitToRequestBeAnnounced(apiEndpoint: string, request: any, announceTimeout:number=3*60e3) {
  let confirmed = false;
  const checkStartTime = Date.now()
  while (!confirmed) {
    /**
     wait to request confirmed by app party
     will timeout after 3 minutes
     */
    if(Date.now()-checkStartTime > announceTimeout)
      throw `request confirmation timed out`;

    /** check every 5 seconds */
    await timeout(5000);

    const check = await muonCall(apiEndpoint, {
      app: 'explorer',
      method: 'req-check',
      params: {request}
    })
    // console.dir(check, {depth: 6});
    if(check?.result?.isValid === false)
      throw `invalid request`

    const t = check?.result?.tss?.t
    const announced = check?.result?.announced?.primary
    if(!t || !announced)
      continue;

    const announcedCount = Object.values(announced).filter(n => n===true).length;
    if(announcedCount >= t) {
      confirmed = true;
      console.log('request confirmed by app party')
    }
    else
      console.log(`${announcedCount} of ${t} are announced.`);
  }
}

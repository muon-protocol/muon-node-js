import axios from 'axios'
import {timeout} from "../utils/helpers.js";

export function muonCall(url, request) {
  return axios.post(url, request)
    .then(({data}) => data);
}

export type AnnounceCheckOptions = {
  announceTimeout?: number,
  checkSecondaryParty?: boolean,
}

export async function waitToRequestBeAnnounced(apiEndpoint: string, request: any, options?:AnnounceCheckOptions) {
  const configs = {
    announceTimeout: 3*60e3,
    checkSecondaryParty: false,
    ...options
  };
  let confirmed = false;
  const checkStartTime = Date.now()
  let n = 0;
  while (!confirmed) {
    n++;
    /**
     wait to request confirmed by app party
     will timeout after 3 minutes
     */
    if(Date.now()-checkStartTime > configs.announceTimeout)
      throw `request confirmation timed out`;

    /** check every 5 seconds */
    await timeout(n === 1 ? 1000 : 5000);

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

    //console.log(check?.result?.announced)

    const announcedCount = Object.values(announced).filter(n => n===true).length;
    if(announcedCount >= t) {
      confirmed = true;
      if(configs.checkSecondaryParty){
        const announced = check?.result?.announced?.secondary
        if(!!announced && Object.keys(announced).length>0) {
          const announcedCount = Object.values(announced).filter(n => n===true).length;
          confirmed = announcedCount >= t || announcedCount === Object.keys(announced).length;
        }
      }
    }
    else
      console.log(`${announcedCount} of ${t} are announced.`);
  }
  console.log('request confirmed by app party')
}

import axios from 'axios'
import {timeout} from "../utils/helpers.js";
import {MapOf} from "../common/mpc/types";

export function muonCall(url, request) {
  return axios.post(url, request)
    .then(({data}) => data);
}

export type AnnounceCheckOptions = {
  announceTimeout?: number,
  checkAllGroups?: boolean,
}

export async function waitToRequestBeAnnounced(apiEndpoint: string, request: any, options?:AnnounceCheckOptions) {
  const configs = {
    announceTimeout: 3*60e3,
    checkAllGroups: false,
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
    const groupsAnnounced: MapOf<boolean>[] = check?.result?.groupsAnnounced
    if(!t || !groupsAnnounced[0])
      continue;

    let numGroupsToCheck = 1;
    if(configs.checkAllGroups)
      numGroupsToCheck = groupsAnnounced.length

    confirmed = true;
    for(let i=0 ; i<numGroupsToCheck && confirmed ; i++) {
      const announcedCount = Object.values(groupsAnnounced[i]).filter(n => n === true).length;
      confirmed = announcedCount >= t;
    }

    if(!confirmed)
      console.log(`not announced yet.`);
  }
  console.log('request confirmed by app party')
}

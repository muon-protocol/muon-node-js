import {muonSha3} from "../../utils/sha3.js";
import * as crypto from "../../utils/crypto.js";

export const command = 'admin <action>'

export const describe = 'admin user commands'

export const builder = {
  action: {
    describe: "action",
    choices: ['create-token'],
    type: 'string',
  },
}

export async function handler(argv) {
  const {action} = argv;

  switch (action) {
    case 'create-token': {
      await createToken(argv)
    }
  }
}

async function createToken(argv) {
  let lifetime = 5*60e3;
  if(argv.lifetime && parseInt(argv.lifetime) > 0)
    lifetime = parseInt(argv.lifetime)
  const timestamp = Date.now();
  const hash = muonSha3(
    {t: 'uint64', v: timestamp},
    {t: 'uint64', v: lifetime},
    {t: 'string', v: 'muon-admin-access'},
  )
  const accessToken = `${timestamp}:${lifetime}:${crypto.sign(hash)}`;
  console.log(`Access Token: ${accessToken}`)
}

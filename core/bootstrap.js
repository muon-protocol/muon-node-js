const prompt = require('prompt-sync')({ sigint: true });
const path = require('path')
const mkdirp = require('mkdirp')
const PeerId = require('peer-id')
const fs = require('fs')
const Web3 = require('web3');
const web3 = new Web3()

const getConfDir = () => {
  let baseDir = `${__dirname}/../config/`
  return !!process.env.CONFIG_BASE_PATH ? baseDir + process.env.CONFIG_BASE_PATH : baseDir
}
const userConfirmed = text => ['y', 'yes', 'ok', '1'].includes(text.toLowerCase())
const moduleExist = _module => {
  try{
    require.resolve(_module)
    return true
  }
  catch (e) {
    return false;
  }
}

async function bootstrap(){
  let configDir = getConfDir();
  mkdirp.sync(configDir);

  let net, account, peerId, tss;

  if(moduleExist(`../config/global/net.conf.json`)) {
    net = require('../config/global/net.conf.json')
  }
  else {
    net = require('../config/global/net.default.conf.json')
  }

  if(!moduleExist(`${configDir}/stakeWallet.conf.json`)) {
    // const res = prompt('there is no stake wallet config. would you like to generate new stake wallet for you? ');
    // if(!userConfirmed(res)){
    //   process.exit(0);
    // }
    console.log('stakeWallet not exist creating new one ...')
    account = web3.eth.accounts.create()
    fs.writeFileSync(`${configDir}/stakeWallet.conf.json`, JSON.stringify(account, null, 2))
  }
  else{
    let acc = require(`${configDir}/stakeWallet.conf.json`)
    account = web3.eth.accounts.privateKeyToAccount(acc.privateKey)
  }
  if(!moduleExist(`${configDir}/peer.conf.json`)) {
    // const res = prompt('there is no peer config. would you like to generate new peerId for you? ');
    // if(!userConfirmed(res)){
    //   process.exit(0);
    // }
    console.log('PeerId not exist creating new one ...')
    peerId = await PeerId.create({bits: 1024, keyType: 'RSA'})
    peerId = peerId.toJSON()
    fs.writeFileSync(`${configDir}/peer.conf.json`, JSON.stringify(peerId, null, 2))
  }
  else{
    if(process.env.VERBOSE)
      console.log(`loading peerID from ${configDir}/peer.conf.json`)
    peerId = require(`${configDir}/peer.conf.json`)
  }

  if(moduleExist(`${configDir}/tss.conf.json`)) {
    tss = require(`${configDir}/tss.conf.json`)
  }

  return {
    account,
    peerId,
    tss,
    net
  }
}

module.exports = bootstrap;

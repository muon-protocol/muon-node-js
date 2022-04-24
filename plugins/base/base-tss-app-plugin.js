const BaseAppPlugin = require('./base-app-plugin')
const { getTimestamp, timeout } = require('../../utils/helpers')
const tss = require('../../utils/tss');
const {toBN} = require('../../utils/tss/utils')
const {remoteApp, remoteMethod, gatewayMethod} = require('../base/app-decorators')

@remoteApp
class BaseTssAppPlugin extends BaseAppPlugin {

  getNSign () {
    if(!this.tssPlugin.isReady)
      throw {message: 'Tss not initialized'};
    return this.tssPlugin.tssKey.party.t;
  }

  get tssWalletAddress(){
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    return tss.pub2addr(tssPlugin.tssKey.publicKey)
  }

  async onFirstNodeRequestSucceed(request){
    let tssPlugin = this.muon.getPlugin(`tss-plugin`)
    if(!tssPlugin.isReady){
      throw {message: 'Tss not initialized'};
    }
    let party = tssPlugin.tssKey.party;
    // console.log('party generation done.')
    if(!party)
      throw {message: 'party not generated'}

    let nonceParticipantsCount = Math.ceil(party.t * 1.2)
    let nonce = await tssPlugin.keyGen(party, nonceParticipantsCount)

    // let sign = tssPlugin.sign(null, party);
    return {
      party: party.id,
      nonce: nonce.id,
      // noncePub: nonce.publicKey.encode('hex'),
      nonceAddress: tss.pub2addr(nonce.publicKey),
    }
  }

  /**
   * Override BaseAppPlugin request broadcast method
   * @param request
   */
  broadcastNewRequest(request) {
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let {data: {init: {party: partyId, nonce: nonceId}}} = request;
    let party = tssPlugin.getParty(partyId)
    let nonce = tssPlugin.getSharedKey(nonceId)

    let partners = Object.values(party.partners)
      .filter(({wallet}) => (wallet !== process.env.SIGN_WALLET_ADDRESS && nonce.partners.includes(wallet)))

    this.requestManager.setPartnerCount(request._id, partners.length + 1);

    partners.map(async ({peer, wallet}) => {
      return this.remoteCall(peer, 'wantSign', request, {timeout: this.REMOTE_CALL_TIMEOUT})
        .then(this.__onRemoteSignRequest.bind(this))
        .catch(e => {
          // console.log('base-tss-app-plugin: on broadcast request error', e)
          return this.__onRemoteSignRequest(null, {
            request: request._id.toString(),
            peerId: peer.id,
            ...e
          });
        })
    })
  }

  makeSignature(request, result, resultHash) {
    let signTimestamp = getTimestamp()
    // let signature = crypto.sign(resultHash)

    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let {data: {init: {party: partyId, nonce: nonceId}}} = request;
    let party = tssPlugin.getParty(partyId)
    let nonce = tssPlugin.getSharedKey(nonceId)

    let tssKey = tssPlugin.tssKey;
    let k_i = nonce.share
    let K = nonce.publicKey;
    let signature = tss.schnorrSign(tssKey.share, k_i, K, resultHash)

    const currentNodeIndex = nonce.party.partners[process.env.SIGN_WALLET_ADDRESS].i

    return {
      request: request._id,
      // node stake wallet address
      owner: process.env.SIGN_WALLET_ADDRESS,
      // tss shared public key
      pubKey: tss.keyFromPrivate(tssKey.share).getPublic().encode('hex'),
      timestamp: signTimestamp,
      data: result,
      signature:`0x${signature.s.toString(16)},0x${signature.e.toString(16)}`
    }
  }

  recoverSignature(request, sign) {
    let tt0 = Date.now();
    let {owner, pubKey: pubKeyStr} = sign;
    let pubKey = tss.keyFromPublic(pubKeyStr);
    // TODO: need to recheck
    // if(owner !== tss.pub2addr(pubKey)) {
    //   console.log({owner, pubKeyStr,})
    //   throw {message: 'Sign recovery error: invalid pubKey address'}
    // }

    let [s, e] = sign.signature.split(',').map(toBN)
    // let sig = {s, e}
    //
    let tssPlugin = this.muon.getPlugin('tss-plugin');
    let {data: {init: {nonce: nonceId}}} = request;
    let nonce = tssPlugin.getSharedKey(nonceId)
    //
    // let idx = this.muon.getNodesWalletIndex()[sign.owner];
    let idx = nonce.party.partners[owner].i;
    let Z_i = pubKey;
    let K_i = nonce.getPubKey(idx);

    let p1 = tss.pointAdd(K_i, Z_i.mul(e.neg())).encode('hex')
    let p2 = tss.curve.g.mul(s).encode('hex');
    return p1 === p2 ? owner : null;
  }

  async isOtherNodesConfirmed(newRequest) {
    let signers = {}

    let {party: partyId} = newRequest.data.init;
    let party = this.tssPlugin.getParty(partyId);
    let masterWalletPubKey = this.muon.getSharedWalletPubKey()
    let signersIndices;

    signers = await this.requestManager.onRequestSignFullFilled(newRequest._id)

    let owners = Object.keys(signers)
    let allSignatures = owners.map(w => signers[w]);

    let schnorrSigns = allSignatures.map(({signature}) => {
      let [s, e] = signature.split(',').map(toBN)
      return {s, e};
    })
    signersIndices = owners.map(w => this.muon.getNodesWalletIndex()[w])
    let aggregatedSign = tss.schnorrAggregateSigs(party.t, schnorrSigns, signersIndices)
    let resultHash = this.hashRequestResult(newRequest, newRequest.data.result);

    // TODO: check more combination of signatures. some time one combination not verified bot other combination does.
    let confirmed = tss.schnorrVerify(masterWalletPubKey, resultHash, aggregatedSign)

    return [
      confirmed,
      confirmed ? [{
        owner: tss.pub2addr(masterWalletPubKey),
        ownerPubKey: {
          x: '0x' + masterWalletPubKey.x.toString(16),
          yParity: masterWalletPubKey.y.mod(toBN(2)).toString(),
        },
        // signers: signersIndices,
        timestamp: getTimestamp(),
        result: newRequest.data.result,
        // signature: `0x${aggregatedSign.s.toString(16)},0x${aggregatedSign.e.toString(16)}`,
        signature: `0x${aggregatedSign.s.toString(16)}`,
        // sign: {
        //   s: `0x${aggregatedSign.s.toString(16)}`,
        //   e: `0x${aggregatedSign.e.toString(16)}`
        // },
        memWriteSignature: allSignatures[0]['memWriteSignature']
      }] : []
    ]
  }

  get tssPlugin(){
    return this.muon.getPlugin('tss-plugin');
  }

  @remoteMethod('wantSign')
  async __onRemoteWantSign(request) {
    let {nonce: nonceId} = request.data.init;
    let nonce = this.tssPlugin.getSharedKey(nonceId);
    // wait for nonce broadcast complete
    await nonce.waitToFulfill()

    let [sign, memWrite] = await this.processRemoteRequest(request)
    // console.log('wantSign', request._id, sign)
    return { sign, memWrite }
  }
}

module.exports = BaseTssAppPlugin

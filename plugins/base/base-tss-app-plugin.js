const BaseAppPlugin = require('./base-app-plugin')
const { getTimestamp, timeout } = require('../../utils/helpers')
const Signature = require('../../gateway/models/Signature')
const tss = require('../../utils/tss');
const {toBN} = require('../../utils/tss/utils')
const Point = require('../../utils/tss/point')


class BaseTssAppPlugin extends BaseAppPlugin {

  async onStart() {
    super.onStart()

    let remoteCall = this.muon.getPlugin('remote-call')
    remoteCall.on(
      `remote:app-${this.APP_NAME}-wantSign`,
      this.__onRemoteWantSign.bind(this)
    )
  }

  getNSign () { return 8 }

  async _onArrive(request){
    let {nSign} = request;
    let t1 = Date.now()
    let tssPlugin = this.muon.getPlugin(`__tss-plugin__`)
    let party = await tssPlugin.makeParty(nSign)
    let t2 = Date.now()
    // console.log('party generation done.', party)
    if(!party)
      throw {message: 'party not generated'}

    let nonce = await tssPlugin.keyGen(party)

    let now = Date.now();
    console.log('nonce key generation', {
      partyTime: t2-t1,
      keyTime: now - t2,
      total: now-t1
    })

    // let sign = tssPlugin.sign(null, party);
    return {party: party.id, nonce: nonce.id}
  }

  broadcastNewRequest(request) {
    let tssPlugin = this.muon.getPlugin('__tss-plugin__');
    let {data: {init: {party: partyId, nonce: nonceId}}} = request;
    let party = tssPlugin.getParty(partyId)
    let nonce = tssPlugin.getSharedKey(nonceId)

    Object.values(party.partners)
      .filter(({wallet}) => wallet!==process.env.SIGN_WALLET_ADDRESS)
      .map(async ({peer}) => {
        this.remoteCall(peer, 'wantSign', request)
          .then(this.__onRemoteSignRequest.bind(this))
          .catch(e => {
            // console.log('base-tss-app-plugin: on broadcast request error', e)
          })
      })
  }

  makeSignature(request, result, resultHash) {
    let signTimestamp = getTimestamp()
    // let signature = crypto.sign(resultHash)

    let tssPlugin = this.muon.getPlugin('__tss-plugin__');
    let {data: {init: {party: partyId, nonce: nonceId}}} = request;
    let party = tssPlugin.getParty(partyId)
    let nonce = tssPlugin.getSharedKey(nonceId)

    let k_i = nonce.getTotalFH().f
    let K = nonce.getTotalPubKey();
    let signature = tss.schnorrSign(process.env.SIGN_WALLET_PRIVATE_KEY, k_i, K, resultHash)
    return {
      request: request._id,
      owner: process.env.SIGN_WALLET_ADDRESS,
      pubKey: tss.keyFromPrivate(process.env.SIGN_WALLET_PRIVATE_KEY).getPublic().encode('hex'),
      timestamp: signTimestamp,
      data: result,
      signature:`0x${signature.s.toString(16)},0x${signature.e.toString(16)}`
    }
  }

  recoverSignature(request, sign) {
    let {owner, pubKey: pubKeyStr} = sign;
    let pubKey = tss.keyFromPublic(pubKeyStr);
    if(owner !== tss.pub2addr(pubKey)) {
      console.log({owner, pubKeyStr,})
      throw {message: 'Sign recovery error: invalid pubKey address'}
    }

    let [s, e] = sign.signature.split(',').map(toBN)
    // let sig = {s, e}
    //
    let tssPlugin = this.muon.getPlugin('__tss-plugin__');
    let {data: {init: {nonce: nonceId}}} = request;
    let nonce = tssPlugin.getSharedKey(nonceId)
    //
    let idx = this.muon.getNodesWalletIndex()[sign.owner];
    let Z_i = pubKey;
    let K_i = nonce.getPubKey(idx);

    let p1 = tss.pointAdd(K_i, Z_i.mul(e.neg()))
    let p2 = tss.curve.g.mul(s);
    return p1.encode('hex') === p2.encode('hex') ? sign.owner : null;
  }

  async isOtherNodesConfirmed(newRequest) {
    let signers = {}

    let {party: partyId} = newRequest.data.init;
    let party = this.getTssPlugin().getParty(partyId);
    let masterWalletPubKey = this.muon.getSharedWalletPubKey()
    let signersIndices;

    signers = await this.reqquestManager.onRequestSignFullFilled(newRequest._id)

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
          signers: signersIndices,
          timestamp: getTimestamp(),
          result: newRequest.data.result,
          signature: `0x${aggregatedSign.s.toString(16)},0x${aggregatedSign.e.toString(16)}`,
          memWriteSignature: allSignatures[0]['memWriteSignature']
      }] : []
    ]
  }

  getTssPlugin(){
    return this.muon.getPlugin('__tss-plugin__');
  }

  async __onRemoteWantSign(request) {
    let {nonce: nonceId} = request.data.init;
    let nonce = this.getTssPlugin().getSharedKey(nonceId);
    // wait for nonce broadcast complete
    await nonce.getSharedKey()

    let [sign, memWrite] = await this.processRemoteRequest(request)
    // console.log('wantSign', request._id, sign)
    return { sign, memWrite }
  }
}

module.exports = BaseTssAppPlugin

import mongoose from 'mongoose'
import {MODEL_APP_CONTEXT} from './constants.js'
import {muonSha3} from '../../utils/sha3.js'

const TssPartyInfo = mongoose.Schema({
  t: {type: Number, required: true},
  max: {type: Number},
  partners: {type: [String], required: true},
}, {_id: false})

const TssPublicKeyInfo = mongoose.Schema({
  address: {type: String, required: true},
  encoded: {type: String, required: true},
  x: {type: String, required: true},
  yParity: {type: Number, enum: [0, 1], required: true},
}, {_id: false})

const TssPolynomialInfo = mongoose.Schema({
  t: {type: Number, required: true},
  Fx: {type: [String], required: true},
},{_id: false})


const modelSchema = mongoose.Schema({
  appId: {type: String, required: true},
  appName: {type: String, required: true},
  previousSeed: {type: String},
  seed: {type: String, required: true},
  isBuiltIn: {type: Boolean, default: false},
  party: {type: TssPartyInfo},
  /**
   Is TSS key periodic rotation enabled?
   If enabled, TSS key will expire and needs to be reshared periodically.
   */
  rotationEnabled: {type: Boolean, default: true},
  /**
   Amount of time that a Context is valid after creation (in seconds)
   */
  ttl: {type: Number},
  pendingPeriod: {type: Number},
  /**
   Party is not valid after this time
   This time is: CreationTime + TTL + PendingPeriod
   */
  expiration:{type: Number},
  deploymentRequest: {type: Object},
  publicKey: {type: TssPublicKeyInfo},
  polynomial: {type: TssPolynomialInfo}
}, {timestamps: true});

modelSchema.pre('save', function (next) {
  /** force appId to be hex string */
  this.appId = BigInt(this.appId).toString(10);
  if(this.deploymentRequest && this.deploymentRequest.method === 'tss-rotate'){
    if(!this.previousSeed)
      throw `Missing previousSeed on context`
  }
  if(!this.dangerousAllowToSave)
    throw `AppContext save only allowed from NetworkAppManager`

  next();
})

modelSchema.virtual('hash').get(function () {
  return muonSha3(
    {t: 'uint256', v: this.appId},
    {t: 'uint256', v: this.seed}
    )
});

// modelSchema.index({ owner: 1, version: 1, appId: 1}, { unique: true });

export function hash(context) {
  const items = [
    {t: "uint256", v: context.seed},
    {t: "uint256", v: context.appId},
    {t: "uint32", v: context.party.t},
    ... context.party.partners.map(v => ({t: 'uint64', v}))
  ]
  return muonSha3(...items)
}

export default mongoose.model(MODEL_APP_CONTEXT, modelSchema);

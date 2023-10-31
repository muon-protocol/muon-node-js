import mongoose from 'mongoose'
import {MODEL_APP_CONTEXT, MODEL_APP_TSS_CONFIG} from './constants.js'
import {isAesEncrypted, aesEncrypt} from '../../utils/crypto.js'

const TssPublicKeyInfo = mongoose.Schema({
  address: {type: String, required: true},
  encoded: {type: String, required: true},
  x: {type: String, required: true},
  yParity: {type: Number, enum: [0, 1], required: true},
},{_id: false})

const TssPolynomialInfo = mongoose.Schema({
  t: {type: Number, required: true},
  Fx: {type: [String], required: true},
},{_id: false})

const modelSchema = mongoose.Schema({
  appId: {type: String, required: true},
  seed: {type: String, required: true},
  publicKey: {type: TssPublicKeyInfo, required: true},
  keyShare: {type: String},
  polynomial: {type: TssPolynomialInfo},
  expiration: {type: Number},
}, {timestamps: true});

modelSchema.pre('save', function (next) {
  if(!this.dangerousAllowToSave)
    throw `AppTssConfig save only allowed from NetworkAppManager`

  const {keyShare} = this
  if(!!keyShare && !isAesEncrypted(keyShare))
    this.keyShare = aesEncrypt(keyShare, process.env.SIGN_WALLET_PRIVATE_KEY);

  next();
})

export default mongoose.model(MODEL_APP_TSS_CONFIG, modelSchema);

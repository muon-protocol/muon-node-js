var mongoose = require('mongoose');
const {MODEL_APP_CONTEXT} = require('./constants')
const soliditySha3 = require('../../utils/soliditySha3')

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

var modelSchema = mongoose.Schema({
  version: {type: Number},
  appId: {type: String, required: true},
  appName: {type: String, required: true},
  seed: {type: String, required: true},
  isBuiltIn: {type: Boolean, default: false},
  party: {type: TssPartyInfo},
  deploymentRequest: {type: Object, required: true},
  publicKey: {type: TssPublicKeyInfo},
  keyShare: {type: String},
  deployTime: {type: Date, required: true},
  reShareTime: {type: Date},
}, {timestamps: true});

modelSchema.pre('save', function (next) {
  /** force appId to be hex string */
  this.appId = BigInt(this.appId).toString(10);

  next();
})

modelSchema.virtual('hash').get(function () {
  return soliditySha3([
    {t: 'uint256', v: this.appId},
    // {t: 'uint64', v: this.version},
    {t: 'uint256', v: this.seed},
  ])
});

// modelSchema.index({ owner: 1, version: 1, appId: 1}, { unique: true });

function hash(context) {
  return soliditySha3([
    {t: "uint32", v: context.version},
    {t: "uint256", v: context.appId},
    {t: "uint32", v: context.party.t},
    ... context.party.partners.map(v => ({t: 'address', v}))
  ])
}

module.exports = mongoose.model(MODEL_APP_CONTEXT, modelSchema);
module.exports.hash = hash;

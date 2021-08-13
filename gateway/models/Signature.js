var mongoose = require('mongoose');
const {MODEL_SIGNATURE} = require('./constants')

var modelSchema = mongoose.Schema({
  request: {type: mongoose.ObjectId, required: true},
  timestamp: {type: Number, required: true},
  owner: {type: String, required: true},
  pubKey: {type: String},
  data: {type: Object},
  signature: {type: String, required: true},
  memWriteSignature: {type: String},
});

var Model = module.exports = mongoose.model(MODEL_SIGNATURE, modelSchema);

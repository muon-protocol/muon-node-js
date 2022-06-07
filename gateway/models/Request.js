var mongoose = require('mongoose');
const {MODEL_REQUEST} = require('./constants')

var modelSchema = mongoose.Schema({
  hash: {type: String, trim: true, /**required: true*/},
  app: {type: String, trim: true, required: true},
  method: {type: String, trim: true},
  // Number of signature needs to confirm.
  nSign: {type: Number},
  // First node (current node) address.
  owner: {type: String, required: true},
  peerId: {type: String, required: true},
  data: {type: Object},
  startedAt: {type: Number, required: true},
  confirmedAt: {type: Number},
}, {minimize: false});

var Model = module.exports = mongoose.model(MODEL_REQUEST, modelSchema);

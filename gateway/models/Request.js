var mongoose = require('mongoose');
const {MODEL_REQUEST} = require('./constants')

var modelSchema = mongoose.Schema({
  symbol: {type: String, required: true},
  price: {type: Number, required: true},
  timestamp: {type: Number, required: true},
  peerId: {type: String, required: true},
  owner: {type: String, required: true},
  source: {type: String, required: true},
  rawPrice: {type: Object},
  startedAt: {type: Number, required: true},
  confirmedAt: {type: Number},
});

var Model = module.exports = mongoose.model(MODEL_REQUEST, modelSchema);

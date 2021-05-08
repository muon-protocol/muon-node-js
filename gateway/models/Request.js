var mongoose = require('mongoose');
const {MODEL_REQUEST} = require('./constants')

var modelSchema = mongoose.Schema({
  app: {type: String, trim: true, required: true},
  method: {type: String, trim: true},
  owner: {type: String, required: true},
  peerId: {type: String, required: true},
  data: {type: Object},
  startedAt: {type: Number, required: true},
  confirmedAt: {type: Number},
});

var Model = module.exports = mongoose.model(MODEL_REQUEST, modelSchema);

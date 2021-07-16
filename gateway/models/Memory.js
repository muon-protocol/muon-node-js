var mongoose = require('mongoose');
const {MODEL_MEMORY} = require('./constants')

var modelSchema = mongoose.Schema({
  app: {type: String},
  timestamp: {type: Number},
  ttl: {type: Number, default: 0},
  nSign: {type: Number},
  data: {type: Object},
  hash: {type: String},
  signatures: {type: [String], required: true},
  expireAt: {type: Date}
}, {timestamps: true});

modelSchema.index({expireAt: 1},{expireAfterSeconds: 0});

const Model = module.exports = mongoose.model(MODEL_MEMORY, modelSchema);

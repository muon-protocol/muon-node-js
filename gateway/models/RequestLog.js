var mongoose = require('mongoose');
const {MODEL_REQ_LOG} = require('./constants')

var modelSchema = mongoose.Schema({
  time: {type: Date},
  ip: {type: String},
  app: {type: String},
  method: {type: String},
  mode: {type: String, enum: ['view', 'sign']},
  success: {type: Boolean},
  confirmed: {type: Boolean},
  errorMessage: {type: String},
});

module.exports = mongoose.model(MODEL_REQ_LOG, modelSchema);

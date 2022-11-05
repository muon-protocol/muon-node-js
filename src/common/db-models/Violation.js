var mongoose = require('mongoose');
const {MODEL_VIOLATION} = require('./constants')

var modelSchema = mongoose.Schema({
  cid: {type: String, required: true},
  description: {type: String},
  content: {type: String},
  expectedResult: {type: Object},
  actualResult: {type: Object},
}, {timestamps: true});

module.exports = mongoose.model(MODEL_VIOLATION, modelSchema);

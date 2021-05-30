var mongoose = require('mongoose');
const {MODEL_CONTENT} = require('./constants')
const {strToCID} = require('../../utils/node-utils/common')

var modelSchema = mongoose.Schema({
  cid: {type: String, required: true},
  content: {type: String, required: true},
  data: {type: Object},
  createdAt: { type: Date, expires: '5m', default: Date.now }
});

const Model = module.exports = mongoose.model(MODEL_CONTENT, modelSchema);

module.exports.create = async data => {
  let content = typeof data === 'string' ? data : JSON.stringify(data);
  let cid = await strToCID(content)

  return new Model({
    cid: cid.toString(),
    content,
    data
  })
}

var mongoose = require('mongoose');
const {MODEL_CONTENT} = require('./constants')
const {createCIDFromString, cid2str} = require('../../utils/node-utils/common')

var modelSchema = mongoose.Schema({
  cid: {type: String, required: true},
  content: {type: String, required: true},
  data: {type: Object},
}, {timestamps: true});
modelSchema.index({createdAt: 1},{expireAfterSeconds: 60 * 60});

const Model = module.exports = mongoose.model(MODEL_CONTENT, modelSchema);

module.exports.create = async data => {
  let content = typeof data === 'string' ? data : JSON.stringify(data);
  let cid = await createCIDFromString(content)

  return new Model({
    cid: cid2str(cid),
    content,
    data
  })
}

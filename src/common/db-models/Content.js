import mongoose from 'mongoose'
import {MODEL_CONTENT} from './constants.js'
import {createCIDFromString, cid2str} from '../../utils/cid.js'

const modelSchema = mongoose.Schema({
  cid: {type: String, required: true},
  reqId: {type: String, /**required: true*/},
  content: {type: String, required: true},
  data: {type: Object},
}, {timestamps: true});
modelSchema.index({createdAt: 1},{expireAfterSeconds: 60 * 60});

const Model = mongoose.model(MODEL_CONTENT, modelSchema);
export default Model;

export const create = async data => {
  let content = typeof data === 'string' ? data : JSON.stringify(data);
  let cid = await createCIDFromString(content)

  return new Model({
    cid: cid2str(cid),
    reqId: data.reqId,
    content,
    data
  })
}

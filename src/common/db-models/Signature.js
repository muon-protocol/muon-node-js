import mongoose from 'mongoose'
import {MODEL_SIGNATURE} from './constants.js'

const modelSchema = mongoose.Schema({
  request: {type: mongoose.ObjectId, required: true, index: { background: false }},
  timestamp: {type: Number, required: true},
  owner: {type: String, required: true},
  pubKey: {type: String},
  data: {type: Object},
  signature: {type: String, required: true},
  memWriteSignature: {type: String},
});

const Model = mongoose.model(MODEL_SIGNATURE, modelSchema);
export default Model

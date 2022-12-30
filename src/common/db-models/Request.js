import mongoose from 'mongoose'
import {MODEL_REQUEST} from './constants.js'

const modelSchema = mongoose.Schema({
  reqId: {type: String, trim: true, /**required: true*/},
  app: {type: String, trim: true, required: true},
  appId: {type: String, trim: true},
  method: {type: String, trim: true},
  // Number of signature needs to confirm.
  nSign: {type: Number},
  // First node (current node) address.
  owner: {type: String/**, required: true*/},
  gwAddress: {type: String/**, required: true*/},
  // peerId: {type: String, required: true},
  data: {type: Object},
  startedAt: {type: Number, required: true},
  confirmedAt: {type: Number},
}, {minimize: false});

const Model = mongoose.model(MODEL_REQUEST, modelSchema);

export default Model

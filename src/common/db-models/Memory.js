import mongoose from 'mongoose'
import {MODEL_MEMORY} from './constants.js'

export const types = {
  App: 'app',
  Node: 'node',
  Local: 'local'
}

const modelSchema = mongoose.Schema({
  type: {type: String, enum: Object.values(types)},
  title: {type: String},
  owner: {type: String},
  timestamp: {type: Number},
  ttl: {type: Number, default: 0},
  nSign: {type: Number},
  data: {type: Object},
  hash: {type: String},
  signatures: {type: [String], required: true},
  expireAt: {type: Date}
}, {timestamps: true});

modelSchema.index({expireAt: 1},{expireAfterSeconds: 0});

const Model = mongoose.model(MODEL_MEMORY, modelSchema);
export default Model;

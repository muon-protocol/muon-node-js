import mongoose from 'mongoose'
import {MODEL_VIOLATION} from './constants.js'

const modelSchema = mongoose.Schema({
  cid: {type: String, required: true},
  description: {type: String},
  content: {type: String},
  expectedResult: {type: Object},
  actualResult: {type: Object},
}, {timestamps: true});

export default mongoose.model(MODEL_VIOLATION, modelSchema);

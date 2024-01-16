import mongoose from 'mongoose'
import {MODEL_REQ_LOG} from './constants.js'

const modelSchema = mongoose.Schema({
  time: {type: Date},
  ip: {type: String},
  app: {type: String},
  method: {type: String},
  params: {type: Object},
  mode: {type: String, enum: ['view', 'sign']},
  gwSign: {type: Boolean},
  success: {type: Boolean},
  confirmed: {type: Boolean},
  errorMessage: {type: String},
  extra: {type: Object},
});

export default mongoose.model(MODEL_REQ_LOG, modelSchema);

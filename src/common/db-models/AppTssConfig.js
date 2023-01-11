import mongoose from 'mongoose'
import {MODEL_APP_CONTEXT, MODEL_APP_TSS_CONFIG} from './constants.js'

const TssPublicKeyInfo = mongoose.Schema({
    address: {type: String, required: true},
    encoded: {type: String, required: true},
    x: {type: String, required: true},
    yParity: {type: Number, enum: [0, 1], required: true},
},{_id: false})

const modelSchema = mongoose.Schema({
    version: {type: Number},
    appId: {type: String, required: true},
    publicKey: {type: TssPublicKeyInfo, required: true},
    keyShare: {type: String, required: true},
}, {timestamps: true});

modelSchema.pre('save', function (next) {
    if(!this.dangerousAllowToSave)
        throw `AppTssConfig save only allowed from NetworkAppManager`

    next();
})

export default mongoose.model(MODEL_APP_TSS_CONFIG, modelSchema);

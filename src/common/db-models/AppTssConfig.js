var mongoose = require('mongoose');
const {
    MODEL_APP_CONTEXT,
    MODEL_APP_TSS_CONFIG
} = require('./constants')

const TssPublicKeyInfo = mongoose.Schema({
    address: {type: String, required: true},
    encoded: {type: String, required: true},
    x: {type: String, required: true},
    yParity: {type: Number, enum: [0, 1], required: true},
},{_id: false})

var modelSchema = mongoose.Schema({
    version: {type: Number},
    appId: {type: String, required: true},
    publicKey: {type: TssPublicKeyInfo, required: true},
    keyShare: {type: String, required: true},
}, {timestamps: true});

module.exports = mongoose.model(MODEL_APP_TSS_CONFIG, modelSchema);

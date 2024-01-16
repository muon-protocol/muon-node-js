import mongoose from 'mongoose'
import {MODEL_SETTING} from './constants.js'

const modelSchema = new mongoose.Schema({
  key: {type: String, required: true, unique: true},
  value: {type: Object},
}, {timestamps: true});

const SettingsModel = mongoose.model(MODEL_SETTING, modelSchema);

export default SettingsModel;

export async function writeSetting(key: string, value: any) {
  return SettingsModel.update({key}, {key, value}, {upsert: true})
}

export async function readSetting(key: string, defaultValue?: any): Promise<any> {
  let setting = await SettingsModel.findOne({key});
  if(setting)
    // @ts-ignore
    return setting.value;
  return defaultValue;
}

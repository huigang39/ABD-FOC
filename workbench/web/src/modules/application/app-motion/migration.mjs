import { MOTION_GAIN_KEYS } from './loops.mjs';

/** Add absent gain slots only; null, zero and all saved values remain untouched. */
export function migrateMotionLoopParameters(instances) {
 const parameters=instances?.['app-motion']?.parameters;
 if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))return instances;
 for(const key of MOTION_GAIN_KEYS)if(!Object.hasOwn(parameters,key))parameters[key]=null;
 return instances;
}

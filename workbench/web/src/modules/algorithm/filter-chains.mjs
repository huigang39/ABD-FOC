/** Scalar filters retain the physical quantity and coordinate domain of their input. */
const frequency={min:0,exclusiveMin:true,rateLimited:true};
export const FILTER_CHILDREN=[
 {id:'low_pass',title:'低通',repeatable:true,fields:[['cutoffHz','截止频率','Hz',{...frequency}]]},
 {id:'notch',title:'陷波',repeatable:true,fields:[['frequencyHz','中心频率','Hz',{...frequency}],['q','Q 值','',{min:0,exclusiveMin:true}]]},
];

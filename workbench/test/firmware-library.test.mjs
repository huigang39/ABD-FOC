import test from 'node:test';
import assert from 'node:assert/strict';
import {firmwareMetadata,filterFirmware,validateFirmwareFile} from '../web/src/features/attachments/model.mjs';
import {renderEquipment} from '../web/src/features/equipment/view.mjs';
import {createProject} from '../web/src/core/model.mjs';
const values={kind:'hardware',name:'驱动固件',target:'STM32H745',version:'v1.0-test+cm7',tags:'beta, test，BETA'};
test('firmware keeps string versions and normalizes tags',()=>{
 const record=firmwareMetadata(values);assert.equal(record.version,values.version);assert.deepEqual(record.tags,['beta','test']);
 assert.equal(record.versionKey,firmwareMetadata({...values,tags:'stable'}).versionKey);
 assert.notEqual(record.versionKey,firmwareMetadata({...values,version:'v2'}).versionKey);
 assert.throws(()=>firmwareMetadata({...values,kind:'unknown'}));assert.throws(()=>firmwareMetadata({...values,version:''}));
});
test('firmware filters type and tag together',()=>{
 const record={...firmwareMetadata(values),createdAt:1};assert.equal(filterFirmware([record],{kind:'hardware',tag:'test'}).length,1);assert.equal(filterFirmware([record],{tag:'stable'}).length,0);
});
test('firmware rejects empty, unsupported and oversized files',()=>{
 for(const file of [{name:'a.hex',size:0},{name:'a.js',size:1},{name:'a.bin',size:33*1024*1024}])assert.throws(()=>validateFirmwareFile(file));
 validateFirmwareFile({name:'firmware.HEX',size:12});
});
test('attachment shelf has five types, tags and escaped metadata',()=>{
 const record={...firmwareMetadata(values),id:'1',name:'<script>',filename:'file.hex',size:128,createdAt:1,sha256:'123'};
 const html=renderEquipment(createProject(),[],'firmware','',undefined,{records:[record],kind:'',tag:''});
 assert.equal((html.match(/data-firmware-component-kind=/g)||[]).length,5);assert.match(html,/整合/);assert.equal(firmwareMetadata({...values,kind:'combined'}).kind,'combined');assert.doesNotMatch(html,/附件库|equipment\/attachments/);assert.match(html,/引导/);assert.match(html,/应用/);assert.match(html,/data-release="test"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<section class="assembly-builder"/);
 assert.match(html,/新建固件/);
});

import {createFirmwareBundle} from '../web/src/features/attachments/bundles.mjs';
test('firmware combinations require all four correctly typed versions and pin hashes',()=>{
 const records=['bootloader','hardware','algorithm','application'].map(kind=>({id:kind,kind,name:kind,version:'v1-beta',sha256:'abc',target:'H745'}));
 const values={name:'NEO',version:'test-1',...Object.fromEntries(records.map(item=>[item.kind,item.id]))};
 const bundle=createFirmwareBundle(values,records);assert.equal(bundle.components.length,4);assert.equal(bundle.components[0].sha256,'abc');
 assert.throws(()=>createFirmwareBundle({...values,hardware:'application'},records));
});

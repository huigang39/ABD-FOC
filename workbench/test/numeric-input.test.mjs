import test from 'node:test';
import assert from 'node:assert/strict';
import {formatNumericValue,parseNumericValue,numericInputAttributes,readNumericInput,numericDraftError,formatHexValue} from '../web/src/shared/forms/numeric-input.mjs';

test('grouped display preserves decimal precision, signs, blank values and scientific notation',()=>{
  for(const [raw,formatted] of [['400000000','400,000,000'],['-1234567.0000123','-1,234,567.0000123'],['1234.567890123456','1,234.567890123456'],['1e-7','1e-7'],['1234e+6','1,234e+6'],['0','0'],['.125','.125'],['','']]){
    assert.equal(formatNumericValue(raw),formatted);
    assert.equal(formatNumericValue(formatted),formatted);
    assert.equal(parseNumericValue(raw),parseNumericValue(formatted));
  }
  assert.equal(formatNumericValue(null),'');assert.equal(parseNumericValue(' '),null);
  assert.equal(readNumericInput({value:'1,234.5'}),1234.5);
});

test('invalid grouping and non-finite input cannot silently become another numeric value',()=>{
  for(const value of ['12,34','1,,000','1,234,56','1.234,5','1,000.12,3','1 000','1e','NaN','Infinity','1e999','0xG123','abc'])assert(Number.isNaN(parseNumericValue(value)),value);
  assert.match(numericInputAttributes(400000000),/value="400,000,000"/);
  assert.match(numericInputAttributes(400000000),/aria-valuenow="400000000"/);
  assert.match(numericInputAttributes(null),/value=""/);
  assert.doesNotMatch(numericInputAttributes(null),/aria-valuenow/);
});

test('radix prefixes are explicit and fault codes display hexadecimal',()=>{
  for(const [text,value] of [['0xFF',255],['0X10',16],['0b1010',10],['0B11',3],['0o17',15],['0O10',8],['010',10],['-0x10',-16],['+0b11',3]])assert.equal(parseNumericValue(text),value);
  for(const text of ['0x','0b2','0o8','0x1.2','0x1,000','0x20000000000000'])assert(Number.isNaN(parseNumericValue(text)));
  for(const text of ['0x','0b','0o']){assert.equal(numericDraftError(text),'');assert(numericDraftError(text,{final:true}));}
  assert.equal(formatHexValue(255),'0x00FF');
  assert.equal(formatNumericValue('0b1010'),'0b1010');
  assert.match(numericInputAttributes(255,{radix:16}),/value="0x00FF"/);
});

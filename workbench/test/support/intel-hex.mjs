import assert from 'node:assert/strict';

/** Independent decoder used to compare every delivered address and byte. */
export function decodeHex(text) {
  const memory=new Map();let base=0,eof=false;
  for(const line of text.trimEnd().split(/\r?\n/)){
    assert.equal(eof,false);assert.match(line,/^:(?:[0-9A-F]{2}){5,}$/);
    const record=Buffer.from(line.slice(1),'hex'),length=record[0],offset=record.readUInt16BE(1),kind=record[3];
    assert.equal(record.length,length+5);assert.equal(record.reduce((sum,byte)=>sum+byte,0)%256,0);
    if(kind===4){assert.equal(offset,0);assert.equal(length,2);base=record.readUInt16BE(4)*65536;}
    else if(kind===0){
      assert(offset+length<=65536);
      for(let i=0;i<length;i++){assert.equal(memory.has(base+offset+i),false);memory.set(base+offset+i,record[i+4]);}
    }else if(kind===1){assert.equal(offset,0);assert.equal(length,0);eof=true;}
    else assert.fail('Unexpected HEX record type');
  }
  assert.equal(eof,true);return memory;
}

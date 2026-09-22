const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const src = fs.readFileSync(require.resolve('../app.js'),'utf8');
const listeners = {};
const app = {innerHTML:'',addEventListener(type,fn){listeners[type]=fn;}};
const picker = {value:'',addEventListener(){}};
const memory = new Map();
const storage = {getItem(k){return memory.get(k)??null;},setItem(k,v){memory.set(k,v);},removeItem(k){memory.delete(k);}};
const context = {crypto,document:{getElementById(id){return id==='app'?app:picker;},addEventListener(){}},localStorage:storage,TextEncoder,TextDecoder,btoa,atob,console,setTimeout(){}};
vm.runInNewContext(src,context,{filename:'app.js'});
async function click(action,id) {
  await listeners.click({target:{closest(){return {dataset:{action,id}};}}});
}
async function pin(code){for(const digit of code)await click('pin-digit',digit);}

test('first-run balance and PIN, money transaction, and PIN unlock work end to end',async()=>{
  assert.match(app.innerHTML,/농협에 얼마가 있나요/);
  for(const digit of '1000000')await click('number',digit);
  assert.match(app.innerHTML,/1,000,000/);
  await click('amount-next');
  assert.match(app.innerHTML,/비밀번호를 설정/);
  await pin('123456');
  assert.match(app.innerHTML,/다시 입력/);
  await pin('123456');
  assert.match(app.innerHTML,/농협 현재 잔액/);
  assert.match(app.innerHTML,/1,000,000원/);
  assert.ok(memory.has('my-money-logger:v1'));
  assert.doesNotMatch(memory.get('my-money-logger:v1'),/initialBalance|123456/);
  await click('start','withdraw');
  for(const digit of '150000')await click('number',digit);
  assert.match(app.innerHTML,/십오만 원/);
  await click('amount-next');
  assert.match(app.innerHTML,/850,000원/);
  await click('approve');
  await pin('123456');
  assert.match(app.innerHTML,/출금 기록이 완료/);
  assert.match(app.innerHTML,/150,000원/);
  await click('done-home');
  assert.match(app.innerHTML,/850,000원/);
  assert.match(app.innerHTML,/다시 채워야 할 금액/);
  await click('lock');
  assert.match(app.innerHTML,/비밀번호를 입력/);
  await pin('123456');
  assert.match(app.innerHTML,/850,000원/);
});

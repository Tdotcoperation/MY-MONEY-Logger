const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;

const script = fs.readFileSync(require.resolve('../app.js'),'utf8');
const marked = script.replace(/\n  init\(\);\n\}\)\(\);\s*$/, '\n  globalThis.__test = {replay,fresh,korean,seal,openVault,deriveKey,random64};\n  init();\n})();');
assert.notEqual(marked,script,'test harness should expose the actual application internals');
const appNode={innerHTML:'',addEventListener(){}};
const fileNode={value:'',addEventListener(){}};
const localStorage={getItem(){return null;},setItem(){},removeItem(){}};
const context={crypto,document:{getElementById(id){return id==='app'?appNode:fileNode;},addEventListener(){}},localStorage,TextEncoder,TextDecoder,btoa,atob,console,setTimeout(){}};
vm.runInNewContext(marked,context,{filename:'app.js'});
const {replay,fresh,korean,seal,openVault,deriveKey,random64}=context.__test;
const record=(id,type,amount,mode,loanId=null)=>({id,at:'2026-09-22T01:00:00Z',localDate:'2026-09-22',localTime:'10:00:00',type,amount,mode,loanId,dueDate:mode==='borrow'?'2026-10-31':null,memo:'',status:'active'});

test('borrowing, partial repayment, ordinary deposit, and adjustment remain separate',()=>{
  const book=fresh(1000000);
  book.events.push(record('borrow','withdraw',150000,'borrow'));
  book.events.push(record('repay','deposit',50000,'repay','borrow'));
  book.events.push(record('normal','deposit',30000,'normal'));
  let result=replay(book);
  assert.equal(result.balance,930000);
  assert.equal(result.debt,100000);
  assert.equal(result.snapshots.get('repay').after,900000);
  book.events.push({...record('adjust','adjust',1200000,'normal'),memo:'reconcile'});
  result=replay(book);
  assert.equal(result.balance,1200000);
  assert.equal(result.debt,100000);
});

test('rejects invalid negative balances and repayments exceeding original borrowing',()=>{
  const book=fresh(100000);
  book.events.push(record('borrow','withdraw',80000,'borrow'));
  book.events.push(record('repay','deposit',50000,'repay','borrow'));
  assert.equal(replay(book).debt,30000);
  book.events[0].status='void';
  assert.throws(()=>replay(book),/연결된 출금/);
  book.events[0].status='active';
  book.events[1].amount=90000;
  assert.throws(()=>replay(book),/상환액/);
  book.events[1].amount=50000;
  book.events.push(record('overdraw','withdraw',200000,'normal'));
  assert.throws(()=>replay(book),/잔액이 부족/);
});

test('shows Korean amount wording',()=>{
  assert.equal(korean('150000'),'십오만 원');
  assert.equal(korean('0'),'영 원');
  assert.equal(korean('1000000'),'백만 원');
});

test('encrypted backups require the original six-digit PIN and round-trip accurately',async()=>{
  const salt=random64(16),key=await deriveKey('123456',salt);
  const source=fresh(123456);source.events.push(record('x','withdraw',456,'normal'));
  const encrypted=await seal(source,key,salt);
  assert.ok(!JSON.stringify(encrypted).includes('123456'));
  const unlocked=await openVault(encrypted,'123456');
  assert.equal(unlocked.book.initialBalance,123456);
  assert.equal(replay(unlocked.book).balance,123000);
  await assert.rejects(openVault(encrypted,'000000'));
});

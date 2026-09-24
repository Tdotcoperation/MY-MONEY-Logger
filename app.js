/* MY MONEY — local-first, manually recorded savings. No bank connection. */
'use strict';
(() => {
  const STORAGE = 'my-money-logger:v1';
  const ITERATIONS = 310000;
  const LIMIT = 999999999999;
  const app = document.getElementById('app');
  const backupInput = document.getElementById('backup-file');
  let vault, data = null, sessionKey = null, screen, tab = 'home';
  let amount = '0', pin = '', pinKeys = [], flow = null, pendingBackup = null;
  let detailId = null, recordView = 'list', searchMode = 'amount', searchAmount = '', searchDate = '';
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let statsMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let modal = null, toastText = '', busy = false, failures = 0, blockedUntil = 0, hiddenAt = 0;
  const fresh = balance => ({ version: 1, initialBalance: balance, events: [], audit: [] });
  const padNums = ['1','2','3','4','5','6','7','8','9','00','0','⌫'];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = n => Math.trunc(n).toLocaleString('ko-KR');
  const won = n => `${money(n)}원`;
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const validInt = n => Number.isSafeInteger(n) && n >= 0 && n <= LIMIT;
  const parseAmount = value => { const n = Number(value); return validInt(n) ? n : NaN; };
  const uid = () => crypto.randomUUID();
  const today = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const stamp = () => { const d = new Date(); return {at:d.toISOString(), localDate:today(d), localTime:d.toLocaleTimeString('ko-KR',{hour12:false})}; };
  const nextDue = () => { const d = new Date(); return today(new Date(d.getFullYear(), d.getMonth()+2, 0)); };
  const dateText = s => s ? s.replaceAll('-', '.') : '—';
  const monthText = d => `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  const kindLabel = item => item.type === 'adjust' ? '잔액 조정' : item.type === 'withdraw' ? (item.mode === 'borrow' ? '다시 채울 돈 출금' : '일반 출금') : (item.mode === 'repay' ? '빌린 돈 채우기' : '일반 입금');
  const korean = input => {
    const n = Number(input);
    if (!n) return '영 원';
    const small = ['', '십', '백', '천'], big = ['', '만', '억', '조'];
    const digit = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    let parts = [], value = n, i = 0;
    while (value && i < big.length) {
      let chunk = value % 10000, part = '';
      for (let k = 0; k < 4; k++) {
        const d = chunk % 10;
        if (d) part = (d === 1 && k > 0 ? '' : digit[d]) + small[k] + part;
        chunk = Math.floor(chunk / 10);
      }
      if (part) parts.unshift(part + big[i]);
      value = Math.floor(value / 10000); i++;
    }
    return `${parts.join(' ')} 원`;
  };
  function replay(book) {
    if (!book || book.version !== 1 || !validInt(book.initialBalance) || !Array.isArray(book.events) || !Array.isArray(book.audit)) throw Error('데이터 형식이 올바르지 않습니다.');
    let balance = book.initialBalance;
    const loans = new Map(), snapshots = new Map();
    for (const ev of book.events) {
      if (ev.status === 'void') continue;
      if (!ev.id || !validInt(ev.amount)) throw Error('잘못된 거래 금액입니다.');
      const before = balance;
      if (ev.type === 'adjust') {
        balance = ev.amount;
      } else if (ev.type === 'withdraw') {
        if (ev.amount === 0 || ev.amount > balance) throw Error('거래 취소·정정 후 잔액이 부족해집니다. 이전 거래를 확인해 주세요.');
        balance -= ev.amount;
        if (ev.mode === 'borrow') loans.set(ev.id, {id:ev.id, initial:ev.amount, remaining:ev.amount, dueDate:ev.dueDate, memo:ev.memo, localDate:ev.localDate});
        else if (ev.mode !== 'normal') throw Error('출금 종류가 잘못되었습니다.');
      } else if (ev.type === 'deposit') {
        if (!ev.amount || balance + ev.amount > LIMIT) throw Error('거래 후 잔액이 허용 금액을 초과합니다.');
        if (ev.mode === 'repay') {
          const loan = loans.get(ev.loanId);
          if (!loan || ev.amount > loan.remaining) throw Error('연결된 출금 금액보다 상환액이 큽니다. 연결된 상환 기록을 먼저 수정해 주세요.');
          loan.remaining -= ev.amount;
        } else if (ev.mode !== 'normal') throw Error('입금 종류가 잘못되었습니다.');
        balance += ev.amount;
      } else throw Error('알 수 없는 거래 종류입니다.');
      snapshots.set(ev.id, {before, after:balance});
    }
    const allLoans = [...loans.values()];
    return {balance, loans:allLoans, debt:allLoans.reduce((sum,l)=>sum+l.remaining,0), snapshots};
  }
  function bytesTo64(bytes) { let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s); }
  function from64(s) { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
  async function deriveKey(code,salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:from64(salt),iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  function random64(n) {return bytesTo64(crypto.getRandomValues(new Uint8Array(n)));}
  async function seal(book,key,salt) {
    const iv = random64(12);
    const plaintext = new TextEncoder().encode(JSON.stringify(book));
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv:from64(iv)},key,plaintext);
    return {format:'MY-MONEY-Logger-v1',iterations:ITERATIONS,salt,iv,ciphertext:bytesTo64(new Uint8Array(ciphertext))};
  }
  function assertVault(v) {
    if (!v || v.format !== 'MY-MONEY-Logger-v1' || v.iterations !== ITERATIONS || !['salt','iv','ciphertext'].every(k=>typeof v[k]==='string' && v[k].length>10)) throw Error('지원하지 않거나 손상된 백업 파일입니다.');
  }
  async function openVault(v,code) {
    assertVault(v);
    const key = await deriveKey(code,v.salt);
    const raw = await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(v.iv)},key,from64(v.ciphertext));
    const book = JSON.parse(new TextDecoder().decode(raw));
    replay(book);
    return {key,book};
  }
  async function save(book,key=sessionKey,salt=vault.salt) {
    replay(book);
    const nextVault = await seal(book,key,salt);
    localStorage.setItem(STORAGE, JSON.stringify(nextVault));
    vault=nextVault; data=book; sessionKey=key;
  }
  async function checkPin(code) {
    if (Date.now() < blockedUntil) throw Error(`잠시 후 다시 입력해 주세요. (${Math.ceil((blockedUntil-Date.now())/1000)}초)`);
    try { const result=await openVault(vault,code); failures=0; return result; }
    catch (err) { failures++; if(failures>=5){blockedUntil=Date.now()+30000;failures=0;} throw Error('비밀번호가 일치하지 않습니다.'); }
  }
  function shufflePin() {
    pin='';pinKeys=['0','1','2','3','4','5','6','7','8','9'];
    for(let i=pinKeys.length-1;i>0;i--){const v=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1);[pinKeys[i],pinKeys[v]]=[pinKeys[v],pinKeys[i]];}
  }
  function showToast(text){toastText=text;render();setTimeout(()=>{if(toastText===text){toastText='';render();}},2800);}
  function nav(){return `<nav class="nav" aria-label="하단 메뉴">${[['home','⌂','홈'],['records','▤','기록'],['settings','⚙','설정']].map(([id,icon,label])=>`<button type="button" data-action="tab" data-id="${id}" class="${tab===id?'active':''}" ${tab===id?'aria-current="page"':''}><span class="symbol" aria-hidden="true">${icon}</span>${label}</button>`).join('')}</nav>`;}
  function header(back=false){return `<header class="header"><div class="row-start">${back?'<button class="icon-btn" data-action="back" aria-label="뒤로">←</button>':''}<div><div class="brand"><b>MY</b> MONEY</div><div class="header-sub">내 저축 기록 · 실제 은행과 연동되지 않음</div></div></div>${data&&!back?'<div class="header-actions"><button class="icon-btn" data-action="lock" title="잠금" aria-label="잠금">♙</button></div>':''}</header>`;}
  const card = (body,extra='')=>`<section class="card ${extra}">${body}</section>`;
  function home(){
    const result=replay(data), debt=result.debt;
    const active=result.loans.filter(l=>l.remaining>0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const paid=result.loans.reduce((s,l)=>s+l.initial-l.remaining,0), initial=result.loans.reduce((s,l)=>s+l.initial,0);
    return `<main class="content"><h1 class="page-title">내 저축</h1><p class="hint">직접 기록한 잔액입니다. 실제 농협 앱의 잔액과 다를 수 있어요.</p><section class="balance-card" style="margin-top:19px"><div class="caption">농협 현재 잔액 · 앱 기록 기준</div><div class="big-number">${won(result.balance)}</div><div class="small">마지막 기록 후 자동 계산된 금액</div></section><section class="card debt-card" style="margin-top:13px"><div class="row"><strong>다시 채워야 할 금액</strong><span class="badge amber">${debt?'상환 대기':'모두 채웠어요'}</span></div><div class="debt-value">${won(debt)}</div><div class="caption">${active.length?`가장 빠른 목표일 · ${dateText(active[0].dueDate)} (${active.length}건)`:'남아 있는 상환 목표가 없습니다.'}</div><div class="progress" role="progressbar" aria-valuenow="${initial?Math.round(paid/initial*100):100}" aria-valuemin="0" aria-valuemax="100"><span style="width:${initial?Math.min(100,paid/initial*100):100}%"></span></div><div class="caption">${initial?`누적 채움 ${won(paid)} / 빌려 쓴 금액 ${won(initial)}`:'출금할 때 ‘다시 채울 돈’을 선택하면 여기에 표시돼요.'}</div></section><div class="buttons"><button class="action-tile deposit" data-action="start" data-id="deposit"><span class="tile-icon">↙</span>입금</button><button class="action-tile" data-action="start" data-id="withdraw"><span class="tile-icon">↗</span>출금</button></div>${active.length?`<h2 class="section-title">다가오는 채우기 목표</h2><div class="stack">${active.slice(0,3).map(l=>card(`<div class="row"><div><strong>${won(l.remaining)}</strong><div class="caption" style="margin-top:5px">${dateText(l.dueDate)}까지 · ${esc(l.memo||'다시 채울 돈')}</div></div><span class="badge ${l.dueDate<today(new Date())?'red':'amber'}">${l.dueDate<today(new Date())?'기한 지남':'진행 중'}</span></div>`)).join('')}</div>`:''}<p class="footnote">실제 은행 입금·출금은 별도로 진행해야 합니다. 이 앱은 기록을 관리합니다.</p></main>`;
  }
  function records(){
    if(detailId) return detailView();
    const list=data.events.filter(ev=>ev.status!=='void'&&ev.type!=='adjust').filter(ev=> searchMode==='date'?(!searchDate||ev.localDate===searchDate):(!searchAmount||String(ev.amount).includes(searchAmount.replace(/^0+(?=\d)/,'')))).reverse();
    return `<main class="content"><div class="row"><h1 class="page-title">기록</h1><span class="badge">최신순</span></div><div class="chip-row" style="margin:14px 0"><button class="chip ${recordView==='list'?'selected':''}" data-action="record-view" data-id="list">거래 내역</button><button class="chip ${recordView==='stats'?'selected':''}" data-action="record-view" data-id="stats">월별 통계</button></div>${recordView==='stats'?statsView():`<div class="chip-row"><button class="chip ${searchMode==='amount'?'selected':''}" data-action="search-mode" data-id="amount">금액 검색</button><button class="chip ${searchMode==='date'?'selected':''}" data-action="search-mode" data-id="date">날짜 검색</button></div>${searchMode==='amount'?`<button class="field" style="text-align:left;margin-top:12px" data-action="search-open" aria-label="자체 키패드로 금액 검색">${searchAmount?money(Number(searchAmount))+'원':'⌕  금액을 입력해 검색'}</button>${searchAmount?'<button class="btn ghost" data-action="search-clear">검색 지우기</button>':''}`:calendarView()}<p class="caption" style="margin:18px 0 10px">${list.length}건의 기록</p><div class="stack">${list.map(ev=>recordCard(ev)).join('')||'<div class="empty">조건에 맞는 거래 기록이 없습니다.</div>'}</div>`}</main>`;
  }
  function recordCard(ev){const dep=ev.type==='deposit';return `<button class="record" data-action="detail" data-id="${esc(ev.id)}"><span class="rec-icon ${ev.type}">${dep?'↙':'↗'}</span><span class="rec-copy"><strong>${kindLabel(ev)}</strong><div class="rec-date">${dateText(ev.localDate)} ${esc(ev.localTime)}${ev.memo?' · '+esc(ev.memo):''}</div></span><span class="rec-amount ${dep?'green':'red'}">${dep?'+':'−'}${won(ev.amount)}</span><span class="muted">›</span></button>`;}
  function statsView(){
    const year=statsMonth.getFullYear(), month=statsMonth.getMonth();
    const items=data.events.filter(e=>e.status!=='void'&&e.type!=='adjust'&&e.localDate.startsWith(`${year}-${String(month+1).padStart(2,'0')}`));
    const sum=filter=>items.filter(filter).reduce((s,e)=>s+e.amount,0);
    const dep=sum(e=>e.type==='deposit'), wd=sum(e=>e.type==='withdraw'), repay=sum(e=>e.mode==='repay');
    return `<div class="row" style="margin:16px 0"><button class="icon-btn" data-action="stats-month" data-id="-1" aria-label="이전 달">‹</button><strong>${monthText(statsMonth)}</strong><button class="icon-btn" data-action="stats-month" data-id="1" aria-label="다음 달">›</button></div><div class="stats-grid">${[['총 입금',won(dep),'green'],['총 출금',won(wd),'red'],['저축 순증감',(dep-wd>=0?'+':'−')+won(Math.abs(dep-wd)),''],['빌린 돈 상환',won(repay),'green']].map(([label,value,color])=>card(`<div class="caption">${label}</div><div class="stat-value ${color}">${value}</div>`)).join('')}</div>${card(`<div class="row"><strong>해당 월 거래</strong><span class="badge">${items.length}건</span></div><p class="hint" style="margin-top:8px">잔액 직접 조정은 입출금 통계에서 제외됩니다. 순증감은 입금에서 출금을 뺀 값입니다.</p>`,'')}`;
  }
  function calendarView(){
    const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth();
    const offset=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();
    return `<div class="card" style="margin-top:12px"><div class="row"><button class="icon-btn" data-action="calendar-month" data-id="-1" aria-label="이전 달">‹</button><strong>${monthText(calendarMonth)}</strong><button class="icon-btn" data-action="calendar-month" data-id="1" aria-label="다음 달">›</button></div><div class="calendar">${['일','월','화','수','목','금','토'].map(d=>`<span class="day-header">${d}</span>`).join('')}${Array(offset).fill('<span class="blank"></span>').join('')}${Array.from({length:days},(_,i)=>{const day=`${y}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;return `<button class="${searchDate===day?'selected':''}" data-action="search-day" data-id="${day}">${i+1}</button>`;}).join('')}</div>${searchDate?`<button class="btn ghost full" data-action="search-clear" style="margin-top:8px">${dateText(searchDate)} 검색 해제</button>`:'<p class="footnote">날짜를 터치하면 해당 날짜의 거래만 표시합니다.</p>'}</div>`;
  }
  function detailView(){
    const ev=data.events.find(e=>e.id===detailId);
    if(!ev||ev.type==='adjust'){detailId=null;return records();}
    const result=replay(data), snap=result.snapshots.get(ev.id), audit=data.audit.filter(a=>a.targetId===ev.id).slice().reverse();
    return `<main class="content"><button class="btn ghost" data-action="detail-back">← 기록으로</button><div class="center" style="padding:23px 0"><div class="success-ring" style="background:${ev.type==='deposit'?'#e0f7ed':'#ffe6eb'};color:${ev.type==='deposit'?'#087c52':'#cf3552'}">${ev.type==='deposit'?'↙':'↗'}</div><h1 class="page-title ${ev.type==='deposit'?'green':'red'}">${ev.type==='deposit'?'+':'−'}${won(ev.amount)}</h1><p class="hint">${kindLabel(ev)}${ev.status==='void'?' · 취소됨':''}</p></div>${card(`<div class="detail-line"><span class="muted">거래 일시</span><strong>${dateText(ev.localDate)} ${esc(ev.localTime)}</strong></div><div class="detail-line"><span class="muted">거래 금액</span><strong>${won(ev.amount)}</strong></div><div class="detail-line"><span class="muted">거래 전 잔액</span><strong>${snap?won(snap.before):'취소됨'}</strong></div><div class="detail-line"><span class="muted">거래 후 잔액</span><strong>${snap?won(snap.after):'취소됨'}</strong></div>${ev.mode==='borrow'?`<div class="detail-line"><span class="muted">채우기 목표일</span><strong>${dateText(ev.dueDate)}</strong></div><div class="detail-line"><span class="muted">아직 채울 금액</span><strong>${won(result.loans.find(l=>l.id===ev.id)?.remaining||0)}</strong></div>`:''}${ev.mode==='repay'?`<div class="detail-line"><span class="muted">연결된 출금</span><strong>${esc(data.events.find(x=>x.id===ev.loanId)?.localDate||'—')}</strong></div>`:''}<div class="detail-line"><span class="muted">메모</span><strong>${esc(ev.memo||'없음')}</strong></div>`) }${ev.status!=='void'?`<div class="btn-row" style="margin-top:16px"><button class="btn secondary" data-action="edit">기록 정정</button><button class="btn danger" data-action="cancel-ask">거래 취소</button></div>`:''}${audit.length?`<h2 class="section-title">변경 이력</h2>${card(audit.map(a=>`<div class="audit"><strong>${a.action==='cancel'?'취소':'정정'}</strong> · ${dateText(a.localDate)} ${esc(a.localTime)}<br>${a.before?won(a.before.amount):''}${a.after?' → '+won(a.after.amount):''}</div>`).join(''))}`:''}</main>`;
  }
  function settings(){const adjustments=data.events.filter(e=>e.type==='adjust').slice().reverse().slice(0,5);return `<main class="content"><h1 class="page-title">설정</h1><p class="hint">계좌와 기록을 관리하고 보안을 설정합니다.</p><h2 class="section-title">계좌 관리</h2><div class="stack">${[['adjust','▤','계좌 잔액 직접 수정','거래 기록 없이 앱 잔액만 변경'],['change-pin','♧','비밀번호 변경','기존 비밀번호 인증 후 6자리 변경']].map(([action,icon,title,desc])=>`<button class="setting-item" data-action="${action}"><span class="s-icon">${icon}</span><span>${title}<div class="caption" style="margin-top:5px">${desc}</div></span><span class="arrow">›</span></button>`).join('')}</div><h2 class="section-title">데이터 관리</h2><div class="stack">${[['backup','⇩','암호화 백업','파일로 내려받기'],['restore','⇧','백업 복원','현재 기록을 백업 파일로 교체'],['reset-ask','♻','데이터 전체 초기화','복구할 수 없는 삭제']].map(([action,icon,title,desc])=>`<button class="setting-item" data-action="${action}"><span class="s-icon">${icon}</span><span>${title}<div class="caption" style="margin-top:5px">${desc}</div></span><span class="arrow">›</span></button>`).join('')}</div>${adjustments.length?`<h2 class="section-title">잔액 조정 이력</h2>${card(adjustments.map(a=>`<div class="detail-line"><span>${dateText(a.localDate)} ${esc(a.localTime)}<div class="caption">${esc(a.memo||'잔액 직접 수정')}</div></span><strong>${a.status==='void'?'취소됨':won(a.amount)}</strong></div>`).join(''))}`:''}<p class="footnote">암호화 데이터는 현재 브라우저에만 저장됩니다. 다른 기기로 자동 동기화되지 않습니다. 6자리 비밀번호는 강력한 은행 인증을 대신할 수 없습니다.</p></main>`;}
  function amountScreen(){
    const isSearch=screen==='search-amount',isSetup=screen==='setup-balance';
    const isAdjust=flow?.kind==='adjust',isEdit=flow?.kind==='edit';
    const title=isSearch?'검색할 금액을 입력해 주세요.':isSetup?'농협에 얼마가 있나요?':isAdjust?'현재 계좌 잔액을 입력하세요.':isEdit?'거래 금액을 수정하세요.':flow.kind==='deposit'?'얼마를 입금하시나요?':'얼마를 출금하시나요?';
    const result=data?replay(data):null;
    const choices=flow&&!isEdit&&!isAdjust&&flow.kind==='withdraw'?`<div class="toggle-row"><button class="chip ${flow.mode==='borrow'?'selected':''}" data-action="mode" data-id="borrow">다시 채울 돈</button><button class="chip ${flow.mode==='normal'?'selected':''}" data-action="mode" data-id="normal">일반 출금</button></div>`:flow&&!isEdit&&!isAdjust&&flow.kind==='deposit'?`<div class="toggle-row"><button class="chip ${flow.mode==='normal'?'selected':''}" data-action="mode" data-id="normal">일반 입금</button><button class="chip ${flow.mode==='repay'?'selected':''}" data-action="mode" data-id="repay" ${!result.loans.some(l=>l.remaining>0)?'disabled':''}>빌린 돈 채우기</button></div>${flow.mode==='repay'?`<div class="entry-hint">어느 출금을 채울까요?</div><div class="chip-row">${result.loans.filter(l=>l.remaining>0).map(l=>`<button class="chip ${flow.loanId===l.id?'selected':''}" data-action="loan" data-id="${esc(l.id)}">${won(l.remaining)} · ${dateText(l.dueDate)}</button>`).join('')}</div>`:''}`:'';
    const memo=!isSearch&&!isSetup?`<label class="field-label" for="memo">${isAdjust?'수정 사유 (선택)':'거래 메모 (선택)'}</label><input id="memo" class="field" type="text" maxlength="100" autocomplete="off" placeholder="${isAdjust?'예: 실제 잔액과 맞추기':'예: 교통비, 용돈'}" value="${esc(flow.memo||'')}">`:'';
    const extra=flow?.mode==='borrow'&&!isEdit?`<div class="entry-hint">다시 채우는 목표일: ${dateText(nextDue())} (다음 달 말일)</div>`:flow?.mode==='repay'?`<div class="entry-hint">선택한 출금의 남은 금액을 초과해 채울 수 없습니다.</div>`:'';
    return `<div class="entry-layout"><section class="entry-info"><h1 class="entry-title">${title}</h1><div class="entry-hint">${isSetup?'실제 은행 계좌와 연결되지 않으며 직접 입력한 금액을 저장합니다.':isSearch?'금액 일부만 입력해도 해당 금액이 포함된 기록을 검색합니다.':result?'현재 기록된 잔액: '+won(result.balance):''}</div><div class="money-row" aria-live="polite"><span class="money-number">${money(Number(amount))}</span><span class="won">원</span></div><div class="korean">${korean(amount)}</div>${choices}${extra}${memo}<div class="entry-bottom"><button class="btn full" data-action="amount-next" ${!Number(amount)&&!isSetup&&!isAdjust&&!isSearch?'disabled':''}>${isSearch?'검색하기':isSetup?'OK':'다음'}</button>${!isSetup?'<button class="btn ghost full" data-action="back">취소</button>':''}</div></section><section class="entry-pad" aria-label="시스템 키보드 대신 사용하는 숫자 키패드"><div class="key-grid">${padNums.map(n=>`<button class="key ${n==='⌫'?'':''}" data-action="number" data-id="${n}" aria-label="${n==='⌫'?'한 자리 지우기':n}">${n==='⌫'?'⌫':n}</button>`).join('')}</div></section></div>`;
  }
  function pinScreen(){
    const setup=['setup-pin','setup-pin-confirm','change-new','change-confirm'].includes(screen);
    const titles={'setup-pin':'비밀번호를 설정해 주세요.','setup-pin-confirm':'비밀번호를 다시 입력해 주세요.','unlock':'비밀번호를 입력해 주세요.','pin-action':'거래를 승인해 주세요.','change-new':'새 비밀번호를 입력해 주세요.','change-confirm':'새 비밀번호를 다시 입력해 주세요.','restore-pin':'백업 비밀번호를 입력해 주세요.'};
    return `<div class="entry-layout"><section class="entry-info"><h1 class="entry-title">${titles[screen]||'비밀번호 인증'}</h1><p class="entry-hint">6자리 숫자를 입력하면 자동으로 확인합니다. 숫자 위치는 매번 무작위로 바뀝니다.</p><div class="pin-dots" aria-label="${pin.length}/6자리 입력">${Array.from({length:6},(_,i)=>`<span class="${i<pin.length?'filled':''}"></span>`).join('')}</div><div class="entry-bottom"><p class="entry-hint">${setup?'6자리 비밀번호는 암호화 키를 만드는 데 사용됩니다. 분실하면 백업 없이 기록을 복구할 수 없습니다.':'비밀번호 입력에는 기기 키보드가 열리지 않습니다.'}</p>${screen!=='unlock'&&screen!=='setup-pin'?'<button class="btn ghost full" data-action="back">취소</button>':''}</div></section><section class="entry-pad" aria-label="무작위 비밀번호 숫자 키패드"><div class="key-grid">${pinKeys.map(n=>`<button class="key" data-action="pin-digit" data-id="${n}" ${busy?'disabled':''}>${n}</button>`).join('')}<button class="key delete" data-action="pin-delete" aria-label="비밀번호 한 자리 지우기" ${busy?'disabled':''}>⌫ 지우기</button></div></section></div>`;
  }
  function confirmScreen(){
    const result=replay(data),preview=flow.preview, tx=flow.kind==='edit'?data.events.find(e=>e.id===flow.id):null;
    let title=flow.kind==='adjust'?'잔액을 변경할까요?':flow.kind==='edit'?'거래를 정정할까요?':`${flow.kind==='deposit'?'입금':'출금'} 금액이 맞나요?`;
    return `<main class="content"><h1 class="page-title">${title}</h1><p class="hint">비밀번호를 확인하면 앱 기록에 반영합니다. 실제 은행 거래가 실행되지는 않습니다.</p><div class="card center" style="margin:22px 0"><div class="caption">${flow.kind==='adjust'?'변경할 계좌 잔액':flow.kind==='edit'?'정정할 거래 금액':flow.kind==='deposit'?'입금 금액':'출금 금액'}</div><div class="big-number" style="color:var(--blue)">${won(Number(amount))}</div><p class="hint">${korean(amount)}</p></div>${card(`<div class="detail-line"><span class="muted">처리 종류</span><strong>${flow.kind==='adjust'?'잔액 직접 수정':flow.kind==='edit'?'기존 기록 정정':flow.kind==='deposit'?(flow.mode==='repay'?'부분/전체 상환':'일반 입금'):(flow.mode==='borrow'?'다시 채울 돈 출금':'일반 출금')}</strong></div>${tx?`<div class="detail-line"><span class="muted">기존 금액</span><strong>${won(tx.amount)}</strong></div>`:''}<div class="detail-line"><span class="muted">현재 잔액</span><strong>${won(result.balance)}</strong></div><div class="detail-line"><span class="muted">처리 후 잔액</span><strong>${won(preview.balance)}</strong></div><div class="detail-line"><span class="muted">처리 후 다시 채울 돈</span><strong>${won(preview.debt)}</strong></div><div class="detail-line"><span class="muted">메모</span><strong>${esc(flow.memo||'없음')}</strong></div>`)}<div class="btn-row" style="margin-top:18px"><button class="btn secondary" data-action="back">수정</button><button class="btn" data-action="approve">승인</button></div></main>`;
  }
  function doneScreen(){const item=flow.done, res=replay(data);return `<main class="content"><div class="success-ring">✓</div><h1 class="page-title center">${esc(flow.doneTitle||'기록이 완료되었습니다.')}</h1><p class="hint center">거래 내용이 암호화되어 이 브라우저에 저장되었습니다.</p><h2 class="section-title">기록된 내용</h2>${card(`<div class="detail-line"><span class="muted">처리 종류</span><strong>${esc(item.label)}</strong></div><div class="detail-line"><span class="muted">기록 일시</span><strong>${dateText(item.localDate)} ${esc(item.localTime)}</strong></div><div class="detail-line"><span class="muted">금액</span><strong>${won(item.amount)}</strong></div><div class="detail-line"><span class="muted">거래 전 잔액</span><strong>${won(item.before)}</strong></div><div class="detail-line"><span class="muted">거래 후 잔액</span><strong>${won(item.after)}</strong></div><div class="detail-line"><span class="muted">현재 다시 채울 돈</span><strong>${won(res.debt)}</strong></div><div class="detail-line"><span class="muted">메모</span><strong>${esc(item.memo||'없음')}</strong></div>`)}<button class="btn full" style="margin-top:20px" data-action="done-home">홈으로 돌아가기</button></main>`;}
  function modalView(){return !modal?'':`<div class="modal-mask"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">${esc(modal.title)}</h2><p>${esc(modal.message)}</p><div class="btn-row"><button class="btn secondary" data-action="modal-close">취소</button><button class="btn ${modal.danger?'danger':''}" data-action="modal-confirm">${esc(modal.confirmLabel||'계속')}</button></div></div></div>`;}
  function render(){
    if(!app)return;
    let body, back=false, mainNav=false;
    if(['setup-balance','amount','search-amount'].includes(screen)){body=amountScreen();back=screen!=='setup-balance';}
    else if(['setup-pin','setup-pin-confirm','unlock','pin-action','change-new','change-confirm','restore-pin'].includes(screen)){body=pinScreen();back=!['setup-pin','unlock'].includes(screen);}
    else if(screen==='confirm'){body=confirmScreen();back=true;}
    else if(screen==='done'){body=doneScreen();}
    else if(screen==='fatal'){body='<main class="content"><h1 class="page-title">이 브라우저에서는 실행할 수 없습니다.</h1><p class="hint">HTTPS 또는 로컬 환경에서 실행하고 브라우저 저장소 및 보안 기능을 활성화해 주세요.</p></main>';}
    else {mainNav=true;body=tab==='home'?home():tab==='records'?records():settings();}
    app.innerHTML=header(back)+body+(mainNav?nav():'')+modalView()+(toastText?`<div class="toast" role="status">${esc(toastText)}</div>`:'');
  }
  function start(kind){const result=replay(data);const outstanding=result.loans.find(l=>l.remaining>0);flow={kind,mode:kind==='withdraw'?'borrow':(kind==='deposit'&&outstanding?'repay':'normal'),loanId:outstanding?.id||null,memo:''};amount='0';screen='amount';render();}
  function back(){
    if(screen==='confirm'){screen='amount';}
    else if(screen==='pin-action'){if(flow?.auth==='commit')screen='confirm';else {screen='main';flow=null;}}
    else if(screen==='setup-pin-confirm'){screen='setup-pin';shufflePin();}
    else if(screen==='change-confirm'){screen='change-new';shufflePin();}
    else if(screen==='restore-pin'){screen='main';pendingBackup=null;}
    else if(screen==='search-amount'){screen='main';tab='records';}
    else if(screen==='amount'){screen='main';flow=null;}
    else if(screen==='change-new'){screen='main';}
    else if(screen==='done'){screen='main';tab='home';flow=null;}
    else if(screen==='main'&&detailId){detailId=null;}
    else if(screen==='main')tab='home';
    pin='';render();
  }
  function putDigit(k,search=false){
    if(k==='⌫'){amount=amount.length>1?amount.slice(0,-1):'0';}
    else {const next=amount==='0'?(k==='00'?'0':k):amount+k;if(next.length<=12&&Number(next)<=LIMIT)amount=next;}
    if(search)searchAmount=amount==='0'?'':amount;
    render();
  }
  function makeEvent(){const s=stamp();const n=Number(amount);return {id:uid(),...s,type:flow.kind==='adjust'?'adjust':flow.kind,amount:n,mode:flow.mode||'normal',loanId:flow.mode==='repay'?flow.loanId:null,dueDate:flow.mode==='borrow'?nextDue():null,memo:flow.memo||'',status:'active'};}
  function proposed(){
    const n=parseAmount(amount);
    if(Number.isNaN(n)||(!n&&flow.kind!=='adjust'))throw Error('올바른 금액을 입력해 주세요.');
    const next=clone(data);
    let target;
    if(flow.kind==='edit'){
      target=next.events.find(e=>e.id===flow.id);
      if(!target||target.status==='void')throw Error('수정할 거래가 없습니다.');
      target.amount=n;target.memo=flow.memo||'';
    }else{
      target=makeEvent();next.events.push(target);
    }
    const calc=replay(next);
    return {next,calc,target};
  }
  function takeReceipt(oldState,nextState,ev,title,labelOverride){const oldCalc=replay(oldState),newCalc=replay(nextState),snap=newCalc.snapshots.get(ev.id);flow.done={label:labelOverride||kindLabel(ev),amount:ev.amount,localDate:ev.localDate,localTime:ev.localTime,memo:ev.memo,before:ev.type==='adjust'?oldCalc.balance:(snap?.before??oldCalc.balance),after:snap?.after??newCalc.balance};flow.doneTitle=title;screen='done';render();}
  async function commit(){
    const old=clone(data), {next,target}=proposed();
    if(flow.kind==='edit'){const original=old.events.find(e=>e.id===target.id);next.audit.push({id:uid(),...stamp(),targetId:target.id,action:'edit',before:clone(original),after:clone(target)});}
    await save(next);
    takeReceipt(old,next,target,flow.kind==='adjust'?'잔액 수정이 완료되었습니다.':flow.kind==='edit'?'기록 정정이 완료되었습니다.':flow.kind==='deposit'?'입금 기록이 완료되었습니다.':'출금 기록이 완료되었습니다.');
  }
  async function cancelTransaction(){
    const old=clone(data),next=clone(data),ev=next.events.find(e=>e.id===detailId);
    if(!ev||ev.status==='void')throw Error('이미 취소한 기록입니다.');
    const original=clone(ev);ev.status='void';
    replay(next);
    next.audit.push({id:uid(),...stamp(),targetId:ev.id,action:'cancel',before:original,after:null});
    await save(next);
    const s=stamp();flow={done:{label:'거래 취소',amount:ev.amount,localDate:s.localDate,localTime:s.localTime,memo:ev.memo,before:replay(old).balance,after:replay(next).balance},doneTitle:'거래 취소가 완료되었습니다.'};detailId=null;screen='done';render();
  }
  async function adjustPin(code){
    if(screen==='setup-pin'){flow={firstPin:code};shufflePin();screen='setup-pin-confirm';render();return;}
    if(screen==='setup-pin-confirm'){
      if(code!==flow.firstPin){screen='setup-pin';flow=null;shufflePin();showToast('비밀번호가 일치하지 않습니다. 처음부터 다시 입력해 주세요.');return;}
      const salt=random64(16), key=await deriveKey(code,salt);
      await save(fresh(Number(amount)),key,salt);
      flow=null;screen='main';tab='home';render();return;
    }
    if(screen==='unlock'){
      const result=await checkPin(code);sessionKey=result.key;data=result.book;
      screen='main';tab='home';render();return;
    }
    if(screen==='change-new'){flow={firstPin:code};shufflePin();screen='change-confirm';render();return;}
    if(screen==='change-confirm'){
      if(code!==flow.firstPin){screen='change-new';shufflePin();showToast('새 비밀번호가 일치하지 않습니다. 다시 설정해 주세요.');return;}
      const salt=random64(16),key=await deriveKey(code,salt);
      await save(data,key,salt);flow=null;screen='main';tab='settings';showToast('비밀번호가 변경되었습니다.');return;
    }
    if(screen==='restore-pin'){
      const result=await openVault(pendingBackup,code);
      // Validate before replacing the user's current vault.
      localStorage.setItem(STORAGE,JSON.stringify(pendingBackup));
      vault=pendingBackup;data=result.book;sessionKey=result.key;pendingBackup=null;flow=null;screen='main';tab='home';detailId=null;render();showToast('백업을 복원했습니다.');return;
    }
    if(screen==='pin-action'){
      await checkPin(code);
      if(flow.auth==='commit')await commit();
      else if(flow.auth==='cancel')await cancelTransaction();
      else if(flow.auth==='change'){flow=null;screen='change-new';shufflePin();render();}
      else if(flow.auth==='reset'){localStorage.removeItem(STORAGE);vault=null;data=null;sessionKey=null;flow=null;detailId=null;amount='0';screen='setup-balance';render();}
    }
  }
  function beginAuth(action){flow=flow||{};flow.auth=action;shufflePin();screen='pin-action';render();}
  function ask(title,message,action,danger=false,confirmLabel='계속'){modal={title,message,action,danger,confirmLabel};render();}
  function getAction(el){return el?.closest('[data-action]');}
  app.addEventListener('input',event=>{if(event.target.id==='memo'&&flow)flow.memo=event.target.value;});
  app.addEventListener('click',async event=>{
    const el=getAction(event.target);if(!el||busy)return;
    const action=el.dataset.action,id=el.dataset.id;
    try{
      if(action==='tab'){tab=id;detailId=null;screen='main';render();}
      else if(action==='start')start(id);
      else if(action==='back'||action==='detail-back')back();
      else if(action==='lock'){data=null;sessionKey=null;detailId=null;screen='unlock';shufflePin();render();}
      else if(action==='number')putDigit(id,screen==='search-amount');
      else if(action==='pin-delete'){pin=pin.slice(0,-1);render();}
      else if(action==='pin-digit'){
        if(pin.length>=6)return;pin+=id;
        if(pin.length===6){const entered=pin;busy=true;render();try{await adjustPin(entered);}catch(err){shufflePin();showToast(err.message||'인증에 실패했습니다. 다시 시도해 주세요.');}finally{busy=false;render();}}
        else render();
      }
      else if(action==='amount-next'){
        if(screen==='setup-balance'){screen='setup-pin';shufflePin();render();}
        else if(screen==='search-amount'){screen='main';tab='records';render();}
        else{const x=proposed();flow.preview={balance:x.calc.balance,debt:x.calc.debt};screen='confirm';render();}
      }
      else if(action==='mode'){flow.mode=id;if(id==='repay'){flow.loanId=replay(data).loans.find(l=>l.remaining>0)?.id||null;}render();}
      else if(action==='loan'){flow.loanId=id;render();}
      else if(action==='approve')beginAuth('commit');
      else if(action==='done-home'){flow=null;screen='main';tab='home';detailId=null;render();}
      else if(action==='record-view'){recordView=id;render();}
      else if(action==='search-mode'){searchMode=id;render();}
      else if(action==='search-open'){amount=searchAmount||'0';screen='search-amount';render();}
      else if(action==='search-clear'){searchAmount='';searchDate='';render();}
      else if(action==='search-day'){searchDate=id;render();}
      else if(action==='calendar-month'){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(id),1);render();}
      else if(action==='stats-month'){statsMonth=new Date(statsMonth.getFullYear(),statsMonth.getMonth()+Number(id),1);render();}
      else if(action==='detail'){detailId=id;render();}
      else if(action==='edit'){
        const ev=data.events.find(e=>e.id===detailId);
        flow={kind:'edit',id:ev.id,mode:ev.mode,loanId:ev.loanId,memo:ev.memo};amount=String(ev.amount);screen='amount';render();
      }
      else if(action==='cancel-ask'){
        const candidate=clone(data),ev=candidate.events.find(e=>e.id===detailId);ev.status='void';replay(candidate);
        ask('거래를 취소할까요?','취소 이력을 남기고 이후 모든 거래의 잔액을 다시 계산합니다. 비밀번호 인증이 필요합니다.','cancel',true,'거래 취소');
      }
      else if(action==='adjust'){flow={kind:'adjust',mode:'normal',memo:''};amount=String(replay(data).balance);screen='amount';render();}
      else if(action==='change-pin')beginAuth('change');
      else if(action==='backup'){
        if(!vault)throw Error('백업할 데이터가 없습니다.');
        const payload={format:'MY-MONEY-Logger-backup',version:1,createdAt:new Date().toISOString(),vault};
        const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`my-money-backup-${today(new Date())}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);showToast('암호화 백업 파일을 내려받았습니다.');
      }
      else if(action==='restore'){backupInput.value='';backupInput.click();}
      else if(action==='reset-ask')ask('모든 데이터를 초기화할까요?','잔액, 기록, 비밀번호를 이 브라우저에서 모두 삭제합니다. 백업이 없다면 복구할 수 없습니다.','reset',true,'초기화 진행');
      else if(action==='modal-close'){modal=null;render();}
      else if(action==='modal-confirm'){const choice=modal.action;modal=null;if(choice==='cancel')beginAuth('cancel');else if(choice==='reset')beginAuth('reset');else if(choice==='restore'){shufflePin();screen='restore-pin';render();} }
    }catch(err){showToast(err.message||'작업에 실패했습니다.');}
  });
  backupInput.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      if(file.size>15*1024*1024)throw Error('백업 파일이 너무 큽니다.');
      const parsed=JSON.parse(await file.text());
      if(parsed.format!=='MY-MONEY-Logger-backup'||parsed.version!==1)throw Error('올바른 MY MONEY 백업 파일이 아닙니다.');
      assertVault(parsed.vault);pendingBackup=parsed.vault;
      ask('현재 데이터를 백업으로 교체할까요?','기존 기록을 덮어씁니다. 복원하기 전에 현재 데이터를 따로 백업해 두세요. 다음 단계에서 백업 생성 당시의 6자리 비밀번호가 필요합니다.','restore',true,'복원 진행');
    }catch(err){pendingBackup=null;showToast(err.message||'백업을 읽을 수 없습니다.');}
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)hiddenAt=Date.now();
    else if(hiddenAt&&Date.now()-hiddenAt>180000&&data){data=null;sessionKey=null;flow=null;detailId=null;screen='unlock';shufflePin();render();}
  });
  function init(){
    try{
      if(!crypto?.subtle||!crypto?.getRandomValues)throw Error('Web Crypto를 사용할 수 없습니다.');
      const raw=localStorage.getItem(STORAGE);
      vault=raw?JSON.parse(raw):null;
      if(vault)assertVault(vault);
      screen=vault?'unlock':'setup-balance';
      if(vault)shufflePin();render();
    }catch(err){console.error('MY MONEY startup:',err);screen='fatal';render();}
  }
  init();
})();

/* Interface enhancements: no bank data or PIN ever leaves the browser. */
'use strict';
(() => {
  const app = document.getElementById('app');
  if (!app) return;
  const SOUND_KEY = 'my-money-logger:touch-sound';
  let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
  let audio = null;
  let previousDone = false;
  let lastTouch = 0;

  function getAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return null;
    if (!audio || audio.state === 'closed') audio = new Audio();
    return audio;
  }

  // Mobile browsers and Android WebViews normally require audio to be resumed
  // directly from a real user gesture, rather than from asynchronous UI updates.
  function unlockAudio() {
    if (!soundEnabled) return null;
    try {
      const ctx = getAudio();
      if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
      return ctx;
    } catch (_) { return null; }
  }

  function tone(kind = 'tap') {
    if (!soundEnabled) return;
    try {
      const ctx = unlockAudio();
      if (!ctx) return;
      const now = ctx.currentTime;
      const spec = kind === 'delete' ? [390, 0.080, 0.075] :
        kind === 'confirm' ? [820, 0.135, 0.095] :
        kind === 'done' ? [980, 0.19, 0.10] : [740, 0.075, 0.085];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(spec[0], now);
      if (kind === 'delete') osc.frequency.exponentialRampToValueAtTime(290, now + spec[1]);
      if (kind === 'done') osc.frequency.exponentialRampToValueAtTime(1240, now + spec[1]);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(spec[2], now + 0.009);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + spec[1]);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + spec[1] + 0.015);
      osc.addEventListener('ended', () => { osc.disconnect(); gain.disconnect(); }, {once:true});
    } catch (_) { /* Unsupported or blocked audio must never interrupt a transaction. */ }
  }

  // Keep the original application's #memo input contract and encrypted storage.
  function improveAmount() {
    const amountPage = app.querySelector('.entry-layout .money-row');
    if (!amountPage) return;
    const field = app.querySelector('.entry-info #memo');
    if (field) {
      const label = app.querySelector('label[for="memo"]');
      if (label) label.remove();
      field.remove();
    }
    const number = amountPage.querySelector('.money-number');
    if (number) { number.style.visibility = 'visible'; number.style.opacity = '1'; }
  }

  function improveConfirmation() {
    const main = app.querySelector('main.content');
    if (!main || !main.querySelector('[data-action="approve"]') || main.querySelector('#memo')) return;
    const memoRow = [...main.querySelectorAll('.detail-line')].find(row => row.firstElementChild?.textContent.trim() === '메모');
    if (!memoRow) return;
    const display = memoRow.lastElementChild;
    if (!display) return;
    const isAdjust = main.querySelector('.page-title')?.textContent.includes('잔액');
    const label = memoRow.firstElementChild;
    label.textContent = isAdjust ? '수정 사유 (선택)' : '거래 메모 (선택)';
    const input = document.createElement('input');
    input.id = 'memo';
    input.className = 'field';
    input.type = 'text';
    input.maxLength = 100;
    input.autocomplete = 'off';
    input.placeholder = isAdjust ? '예: 실제 잔액과 맞추기' : '예: 교통비, 용돈';
    input.value = display.textContent.trim() === '없음' ? '' : display.textContent;
    input.setAttribute('aria-label', label.textContent);
    display.replaceWith(input);
    memoRow.classList.add('memo-confirm-row');
  }

  function improveSettings() {
    const main = app.querySelector('main.content');
    if (!main || main.querySelector('.page-title')?.textContent.trim() !== '설정' || main.querySelector('#touch-sound-toggle')) return;
    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = '앱 환경설정';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'touch-sound-toggle';
    button.className = 'setting-item touch-toggle';
    button.setAttribute('aria-pressed', String(soundEnabled));
    button.innerHTML = '<span class="s-icon" aria-hidden="true">♪</span><span>터치음<div class="caption" style="margin-top:5px">버튼과 키패드를 터치할 때 짧은 소리를 재생합니다. 켜면 시험 소리가 납니다.</div></span><span class="touch-state"></span>';
    button.querySelector('.touch-state').textContent = soundEnabled ? '켜짐' : '꺼짐';
    const foot = main.querySelector('.footnote');
    if (foot) { foot.before(title); title.after(button); }
    else main.append(title, button);
  }

  function improve() {
    improveAmount();
    improveConfirmation();
    improveSettings();
    const isDone = !!app.querySelector('.success-ring') && !!app.querySelector('[data-action="done-home"]');
    if (isDone && !previousDone) tone('done');
    previousDone = isDone;
  }
  // The app re-renders by replacing its contents; respond to each new screen.
  const observer = new MutationObserver(improve);
  observer.observe(app, {childList:true, subtree:true});
  improve();

  // Handle the earliest usable gesture to reliably unlock mobile audio.
  // Play on pointerdown, with click as the accessibility/older-browser fallback.
  function handleSound(event) {
    const button = event.target.closest('button');
    if (!button || button.disabled || !app.contains(button)) return;
    const now = Date.now();
    if (event.type === 'click' && now - lastTouch < 400) return;
    if (event.type === 'pointerdown') lastTouch = now;
    if (button.id === 'touch-sound-toggle') {
      // The toggle itself is handled on click so enabling sound gives feedback.
      return;
    }
    const action = button.dataset.action;
    if ((action === 'number' && button.dataset.id === '⌫') || action === 'pin-delete') tone('delete');
    else if (['amount-next', 'approve', 'done-home', 'modal-confirm'].includes(action)) tone('confirm');
    else tone('tap');
  }
  app.addEventListener('pointerdown', handleSound, {capture:true, passive:true});
  app.addEventListener('click', handleSound, {capture:true});
  app.addEventListener('click', event => {
    const toggle = event.target.closest('#touch-sound-toggle');
    if (!toggle) return;
    soundEnabled = !soundEnabled;
    localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
    toggle.setAttribute('aria-pressed', String(soundEnabled));
    toggle.querySelector('.touch-state').textContent = soundEnabled ? '켜짐' : '꺼짐';
    if (soundEnabled) tone('confirm');
  }, {capture:true});
})();
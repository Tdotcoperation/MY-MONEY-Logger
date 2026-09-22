/* Interface enhancements: no bank data or PIN ever leaves the browser. */
'use strict';
(() => {
  const app = document.getElementById('app');
  if (!app) return;
  const SOUND_KEY = 'my-money-logger:touch-sound';
  let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
  let audio = null;
  let previousDone = false;

  function tone(kind = 'tap') {
    if (!soundEnabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio ||= new Audio();
      if (audio.state === 'suspended') void audio.resume();
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const settings = kind === 'delete' ? [360, 0.055, 0.022] : kind === 'confirm' ? [720, 0.10, 0.025] : kind === 'done' ? [880, 0.16, 0.024] : [660, 0.045, 0.016];
      osc.type = 'sine';
      osc.frequency.setValueAtTime(settings[0], now);
      if (kind === 'done') osc.frequency.exponentialRampToValueAtTime(1100, now + settings[1]);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(settings[2], now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + settings[1]);
      osc.connect(gain).connect(audio.destination);
      osc.start(now);
      osc.stop(now + settings[1] + 0.008);
      osc.addEventListener('ended', () => { osc.disconnect(); gain.disconnect(); }, {once:true});
    } catch (_) { /* Audio unavailable: app remains fully usable. */ }
  }

  // The existing application listens for input#memo. Keep that exact contract,
  // moving the field rather than saving an independent unencrypted copy.
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
    if (number) {
      number.style.visibility = 'visible';
      number.style.opacity = '1';
    }
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
    button.innerHTML = '<span class="s-icon" aria-hidden="true">♪</span><span>터치음<div class="caption" style="margin-top:5px">버튼과 키패드를 터치할 때 짧은 소리를 재생합니다.</div></span><span class="touch-state"></span>';
    button.querySelector('.touch-state').textContent = soundEnabled ? '켜짐' : '꺼짐';
    const foot = main.querySelector('.footnote');
    if (foot) { foot.before(title); title.after(button); }
    else { main.append(title, button); }
  }

  function improve() {
    improveAmount();
    improveConfirmation();
    improveSettings();
    const isDone = !!app.querySelector('.success-ring') && !!app.querySelector('[data-action="done-home"]');
    if (isDone && !previousDone) tone('done');
    previousDone = isDone;
  }
  // Rendering replaces #app contents; enhance each new screen once without
  // intercepting or changing the accounting and encrypted-storage logic.
  const observer = new MutationObserver(() => improve());
  observer.observe(app, {childList:true, subtree:true});
  improve();
  app.addEventListener('click', event => {
    const toggle = event.target.closest('#touch-sound-toggle');
    if (toggle) {
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
      toggle.setAttribute('aria-pressed', String(soundEnabled));
      toggle.querySelector('.touch-state').textContent = soundEnabled ? '켜짐' : '꺼짐';
      if (soundEnabled) tone('confirm');
      return;
    }
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'number' && button.dataset.id === '⌫' || action === 'pin-delete') tone('delete');
    else if (['amount-next', 'approve', 'done-home', 'modal-confirm'].includes(action)) tone('confirm');
    else tone('tap');
  }, {capture:true});
})();
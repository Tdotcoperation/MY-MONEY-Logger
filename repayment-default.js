/* Make the intended repayment flow explicit without changing existing encrypted records.
   The core app owns all transaction validation and saving. */
'use strict';
(() => {
  const app = document.getElementById('app');
  if (!app) return;

  // When opening a NEW deposit from Home, the core starts in `normal` mode.
  // If there is outstanding debt, prefer its existing validated `repay` mode.
  // The user can still explicitly choose "일반 입금" before continuing.
  app.addEventListener('click', event => {
    const button = event.target.closest('button[data-action="start"][data-id="deposit"]');
    if (!button || !app.contains(button) || button.disabled) return;
    queueMicrotask(() => {
      const depositScreen = app.querySelector('.entry-layout');
      const repay = depositScreen?.querySelector('button[data-action="mode"][data-id="repay"]');
      const normal = depositScreen?.querySelector('button[data-action="mode"][data-id="normal"]');
      if (!repay || repay.disabled || !normal || !normal.classList.contains('selected')) return;
      repay.click(); // invokes the core app's repayment selection and accounting
    });
  }, {capture:true});

  // Clarify what is counted, especially when changing back to an ordinary deposit.
  function annotate() {
    const screen = app.querySelector('.entry-layout');
    if (!screen) return;
    const repay = screen.querySelector('button[data-action="mode"][data-id="repay"]');
    const normal = screen.querySelector('button[data-action="mode"][data-id="normal"]');
    if (!repay || !normal || screen.querySelector('#repayment-explanation')) return;
    const note = document.createElement('p');
    note.id = 'repayment-explanation';
    note.className = 'entry-hint';
    note.setAttribute('role','note');
    note.style.cssText = 'font-weight:650;line-height:1.55;margin:0;color:var(--blue)';
    if (repay.disabled) {
      note.textContent = '채워야 할 금액이 없어서 일반 입금으로 기록합니다.';
    } else if (repay.classList.contains('selected')) {
      note.textContent = '✓ 빌린 돈 채우기: 입금액이 잔액에 더해지고, 연결된 출금의 남은 채울 금액에서 차감됩니다. 일반 입금을 원하면 위에서 변경하세요.';
    } else {
      note.textContent = '일반 입금은 잔액만 늘어나며 다시 채워야 할 금액은 줄지 않습니다. 상환하려면 ‘빌린 돈 채우기’를 선택하세요.';
    }
    const choices = repay.closest('.toggle-row');
    choices?.after(note);
  }
  const observer = new MutationObserver(annotate);
  observer.observe(app,{childList:true,subtree:true});
  annotate();
})();
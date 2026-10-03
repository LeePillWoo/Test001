// 화면, 입력, 저장. 규칙은 game.js(Game2048)에 있다.
(function () {
  'use strict';
  const G = window.Game2048;
  const STORAGE_KEY = 'celadon-2048';
  const SWIPE_MIN = 24;
  const LADDER = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];

  const $ = (id) => document.getElementById(id);
  const tilesLayer = $('tiles');
  const board = $('board');
  const overlay = $('overlay');
  const scoreBox = $('score');
  const scoreValue = $('score-value');
  const bestValue = $('best-value');
  const undoBtn = $('undo');

  let state;
  let best = 0;
  let previous = null; // 되돌리기 한 단계
  let keepPlaying = false;
  let pending = null; // 애니메이션 끝에 실행할 정리 작업
  let pendingTimer = 0;
  const tileEls = new Map();

  function slideMs() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--slide')) || 0;
  }

  // 저장소 (사생활 보호 모드 등에서는 실패할 수 있다)
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch {
      /* 저장 못 해도 게임은 계속된다 */
    }
  }
  function snapshot() {
    return { state, best, keepPlaying, previous };
  }

  // 타일 DOM
  function tileValueKey(v) {
    return v > G.WIN_VALUE ? 'super' : String(v);
  }
  function makeTile(tile, cls) {
    const el = document.createElement('div');
    el.className = 'tile' + (cls ? ' ' + cls : '');
    el.dataset.v = tileValueKey(tile.value);
    el.dataset.digits = String(tile.value).length;
    el.style.setProperty('--r', tile.r);
    el.style.setProperty('--c', tile.c);
    const face = document.createElement('div');
    face.className = 'face';
    face.textContent = tile.value;
    el.appendChild(face);
    tilesLayer.appendChild(el);
    tileEls.set(tile.id, el);
    return el;
  }
  function renderAll() {
    flush();
    tilesLayer.textContent = '';
    tileEls.clear();
    for (const t of state.tiles) makeTile(t);
    renderChrome();
  }
  function flush() {
    if (!pending) return;
    clearTimeout(pendingTimer);
    const run = pending;
    pending = null;
    run();
  }

  function renderChrome() {
    scoreValue.textContent = state.score;
    bestValue.textContent = best;
    undoBtn.disabled = !previous;
    const top = G.maxTile(state);
    for (const li of document.querySelectorAll('#ladder li')) {
      const v = Number(li.dataset.v);
      li.classList.toggle('reached', v <= top);
      li.classList.toggle('top', v === top);
    }
    $('ladder-note').textContent =
      top >= G.WIN_VALUE ? `최고 ${top}. 금채에 닿았습니다.` : `지금 최고 타일은 ${top}입니다.`;
    renderOverlay();
  }

  function showGain(n) {
    const el = document.createElement('span');
    el.className = 'gain';
    el.textContent = '+' + n;
    scoreBox.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    setTimeout(() => el.remove(), 900);
  }

  function renderOverlay() {
    let html = '';
    if (state.won && !keepPlaying) {
      html = `
        <h2>2048 완성!</h2>
        <p>점수 ${state.score}점. 금채 타일을 만들었습니다.</p>
        <div class="actions">
          <button class="btn-primary" data-act="continue">계속 하기</button>
          <button class="btn-ghost" data-act="new">새 게임</button>
        </div>`;
    } else if (!G.canMove(state)) {
      html = `
        <h2>더 밀 곳이 없어요</h2>
        <p>최종 점수 ${state.score}점, 최고 타일 ${G.maxTile(state)}.</p>
        <div class="actions">
          <button class="btn-primary" data-act="new">다시 하기</button>
          ${previous ? '<button class="btn-ghost" data-act="undo">한 수 무르기</button>' : ''}
        </div>`;
    }
    overlay.innerHTML = html;
    overlay.hidden = !html;
    if (html) overlay.querySelector('button').focus({ preventScroll: true });
  }

  function blocked() {
    return !overlay.hidden;
  }

  // 게임 진행
  function step(dir) {
    if (blocked()) return;
    flush();
    const result = G.move(state, dir);
    if (!result.moved) return;
    previous = { state, keepPlaying };
    const { state: next, tile: spawned } = G.addRandomTile(result.state);
    state = next;
    if (state.score > best) best = state.score;

    for (const s of result.slides) {
      const el = tileEls.get(s.id);
      if (!el) continue;
      el.classList.remove('spawned', 'merged');
      el.style.setProperty('--r', s.r);
      el.style.setProperty('--c', s.c);
      if (s.consumed) el.classList.add('consumed');
    }

    pending = () => {
      for (const s of result.slides) {
        if (!s.consumed) continue;
        tileEls.get(s.id)?.remove();
        tileEls.delete(s.id);
      }
      for (const m of result.merges) makeTile(m, 'merged');
      if (spawned) makeTile(spawned, 'spawned');
      renderChrome();
    };
    const ms = slideMs();
    if (ms > 0) pendingTimer = setTimeout(flush, ms);
    else flush();

    scoreValue.textContent = state.score;
    bestValue.textContent = best;
    if (result.gained) showGain(result.gained);
    save();
  }

  function newGame() {
    state = G.newGame();
    previous = null;
    keepPlaying = false;
    renderAll();
    save();
  }

  function undo() {
    if (!previous) return;
    state = previous.state;
    keepPlaying = previous.keepPlaying;
    previous = null;
    renderAll();
    save();
  }

  // 입력: 키보드
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'z' || e.key === 'Z' || e.key === 'u') && !blocked()) {
      undo();
      return;
    }
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    step(dir);
  });

  // 입력: 스와이프 (터치, 마우스 드래그 둘 다)
  let start = null;
  board.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  const endSwipe = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? 'right' : 'left');
    else step(dy > 0 ? 'down' : 'up');
  };
  board.addEventListener('pointerup', endSwipe);
  board.addEventListener('pointercancel', () => (start = null));

  // 버튼
  $('new-game').addEventListener('click', newGame);
  undoBtn.addEventListener('click', undo);
  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'new') newGame();
    else if (act === 'undo') undo();
    else if (act === 'continue') {
      keepPlaying = true;
      renderChrome();
      save();
      board.focus({ preventScroll: true });
    }
  });

  // 단계표
  $('ladder').innerHTML = LADDER.map((v) => `<li data-v="${v}">${v}</li>`).join('');

  function isValidState(s) {
    return (
      s && Array.isArray(s.tiles) && s.size === G.SIZE &&
      s.tiles.every((t) => t && t.value > 0 && t.r >= 0 && t.r < G.SIZE && t.c >= 0 && t.c < G.SIZE)
    );
  }

  function boot(saved) {
    const data = saved && isValidState(saved.state) ? saved : load();
    if (data && isValidState(data.state)) {
      state = data.state;
      best = Math.max(Number(data.best) || 0, state.score);
      keepPlaying = !!data.keepPlaying;
      previous = data.previous && isValidState(data.previous.state) ? data.previous : null;
      renderAll();
    } else {
      best = Number(data?.best) || 0;
      newGame();
    }
  }

  // 앱 뷰어에서 페이지가 갱신될 때 진행 중인 판을 이어 간다
  const hot = window.claude?.hot;
  hot?.snapshot?.(snapshot);
  if (hot?.ready) hot.ready(boot);
  else boot(hot?.data ?? null);
})();

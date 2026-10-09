// 화면: 기법 고르기, 원본과 나란히 비교, 재생/정지.
// 주소 옵션 (렌더 하네스용)
//   ?m=<기법 id>   처음 보여줄 기법
//   &raw=1        UI 없이 1254×1254 캔버스만
//   &static=1     애니메이션 없이 한 장면만 (&t=초 로 시각 지정)
//   &seed=<정수>   난수 시드
// 나머지 옵션은 기법의 mount(host, { params })로 그대로 넘어간다.
(function () {
  'use strict';
  const C = window.ConcertCore;
  const METHODS = window.ConcertMethods;
  const params = new URLSearchParams(location.search);
  const raw = params.get('raw') === '1';
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seed = parseInt(params.get('seed') || '7', 10) >>> 0;
  const startTime = parseFloat(params.get('t') || '0') || 0;
  let playing = params.get('static') === '1' ? false : raw ? true : !reduceMotion;

  const $ = (id) => document.getElementById(id);
  const host = $('host');
  const scaleBox = $('stage-scale');
  const stage = $('stage');
  const status = $('status');
  const refImg = $('ref');
  const split = $('split');
  const slider = $('compare');
  const playBtn = $('play');
  const setlist = $('setlist');
  const notes = $('notes');

  let current = null; // { id, handle }
  let token = 0;

  if (raw) document.documentElement.classList.add('raw');

  function raf2() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  function fit() {
    const w = stage.clientWidth;
    scaleBox.style.transform = `scale(${w / C.W})`;
  }

  function setCompare(v) {
    const pct = Math.max(0, Math.min(100, v));
    refImg.style.clipPath = `inset(0 0 0 ${pct}%)`;
    split.style.left = `${pct}%`;
    split.hidden = pct <= 0 || pct >= 100;
  }

  function methodById(id) {
    return METHODS.find((m) => m.id === id) || METHODS[0];
  }

  async function show(id) {
    const my = ++token;
    window.__concertReady = false;
    window.__concertError = null;
    if (current && current.handle && current.handle.destroy) current.handle.destroy();
    current = null;
    host.replaceChildren();
    const m = methodById(id);
    if (!raw) {
      for (const b of setlist.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.id === m.id));
      renderNotes(m);
      status.textContent = '그리는 중…';
      status.hidden = false;
      try {
        history.replaceState(null, '', '#' + m.id);
      } catch {
        /* 일부 뷰어는 주소 변경을 막는다 */
      }
    }
    try {
      await C.loadScript(m.entry);
      const impl = await C.whenDefined(m.id);
      if (my !== token) return;
      const handle = await impl.mount(host, { animate: playing, time: startTime, seed, params, raw });
      if (my !== token) {
        if (handle && handle.destroy) handle.destroy();
        return;
      }
      current = { id: m.id, handle };
      await raf2();
      status.hidden = true;
      window.__concertReady = true;
    } catch (err) {
      console.error(err);
      window.__concertError = String((err && err.stack) || err);
      status.textContent = '이 기법을 그리지 못했습니다. 콘솔 오류를 확인해 주세요.';
      status.hidden = false;
    }
  }

  // 하네스가 같은 페이지에서 여러 시각을 찍을 때 쓴다.
  window.__concertRenderAt = async (t) => {
    if (current && current.handle && current.handle.renderAt) await current.handle.renderAt(t);
    await raf2();
    return true;
  };

  function setPlaying(next) {
    playing = next;
    if (playBtn) {
      playBtn.setAttribute('aria-pressed', String(playing));
      playBtn.textContent = playing ? '멈춤' : '재생';
    }
    if (current && current.handle && current.handle.setPlaying) current.handle.setPlaying(playing);
    else if (current) show(current.id);
  }

  function renderNotes(m) {
    if (!notes) return;
    const scores = window.ConcertScores || {};
    const s = scores[m.id];
    notes.querySelector('[data-k="title"]').textContent = m.title;
    notes.querySelector('[data-k="uses"]').textContent = m.uses;
    const score = notes.querySelector('[data-k="score"]');
    if (score) score.textContent = s ? `${(s.ssim_small * 100).toFixed(1)}` : '–';
  }

  function buildSetlist() {
    METHODS.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.id = m.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span><span class="name"></span>`;
      b.querySelector('.name').textContent = m.title;
      b.addEventListener('click', () => show(m.id));
      setlist.appendChild(b);
    });
  }

  if (!raw) {
    buildSetlist();
    new ResizeObserver(fit).observe(stage);
    fit();
    slider.addEventListener('input', () => setCompare(100 - Number(slider.value)));
    setCompare(100 - Number(slider.value));
    playBtn.addEventListener('click', () => setPlaying(!playing));
    setPlaying(playing);
  } else {
    refImg.hidden = true;
    split.hidden = true;
  }

  const hashId = location.hash.replace('#', '');
  show(params.get('m') || (METHODS.some((m) => m.id === hashId) ? hashId : METHODS[0].id));
})();

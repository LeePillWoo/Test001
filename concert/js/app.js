// 화면: 셋리스트에서 기법 고르기, 원본 겹쳐 보기, 재생/멈춤.
// 주소 옵션 (렌더 하네스용)
//   ?m=<기법 id>   처음 보여줄 기법 (#<id>도 된다)
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
  const replayBtn = $('replay');
  const setlist = $('setlist');
  const notes = $('notes');

  let current = null; // { id, handle }
  let token = 0;

  if (raw) document.documentElement.classList.add('raw');

  function raf2() {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }

  function fit() {
    scaleBox.style.transform = `scale(${stage.clientWidth / C.W})`;
  }

  // 슬라이더 0이면 원본이 숨고, 밀수록 오른쪽부터 원본이 드러난다.
  function setCompare(v) {
    const pct = 100 - Math.max(0, Math.min(100, v));
    refImg.style.clipPath = `inset(0 0 0 ${pct}%)`;
    refImg.style.visibility = pct >= 100 ? 'hidden' : 'visible';
    split.style.left = `${pct}%`;
    split.hidden = pct <= 0 || pct >= 100;
  }

  function methodById(id) {
    return METHODS.find((m) => m.id === id) || METHODS[0];
  }

  function kb(bytes) {
    if (bytes == null) return '–';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function pct(score) {
    return score ? (score.ssim_small * 100).toFixed(1) : '–';
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
        /* 주소를 못 바꾸는 뷰어도 있다 */
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
      status.textContent = '이 기법을 그리지 못했습니다. 브라우저 콘솔에 원인이 있습니다.';
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
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.textContent = playing ? '멈춤' : '재생';
    if (current && current.handle && current.handle.setPlaying) current.handle.setPlaying(playing);
  }

  function renderNotes(m) {
    const s = (window.ConcertScores || {})[m.id];
    const q = (k) => notes.querySelector(`[data-k="${k}"]`);
    q('title').textContent = m.title;
    q('uses').textContent = m.uses;
    const how = q('how');
    how.replaceChildren(
      ...(m.how || []).map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      })
    );
    q('ssim').textContent = s ? `${pct(s)}%` : '–';
    q('de').textContent = s ? s.dE.toFixed(1) : '–';
    q('code').textContent = s ? kb(s.codeBytes) : '–';
    q('data').textContent = s ? (s.dataBytes ? kb(s.dataBytes) : '없음') : '–';
  }

  function buildSetlist() {
    const scores = window.ConcertScores || {};
    METHODS.forEach((m, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'track';
      b.dataset.id = m.id;
      b.setAttribute('aria-pressed', 'false');
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(i + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.title;
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = pct(scores[m.id]);
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = m.short || '';
      b.append(no, name, score, sub);
      b.addEventListener('click', () => show(m.id));
      li.appendChild(b);
      setlist.appendChild(li);
    });
  }

  if (!raw) {
    buildSetlist();
    new ResizeObserver(fit).observe(stage);
    fit();
    slider.addEventListener('input', () => setCompare(Number(slider.value)));
    setCompare(Number(slider.value));
    playBtn.addEventListener('click', () => setPlaying(!playing));
    replayBtn.addEventListener('click', () => {
      if (!playing) setPlaying(true);
      show(current ? current.id : METHODS[0].id);
    });
    setPlaying(playing);
  } else {
    refImg.hidden = true;
    split.hidden = true;
  }

  const hashId = location.hash.replace('#', '');
  show(params.get('m') || (METHODS.some((m) => m.id === hashId) ? hashId : METHODS[0].id));
})();

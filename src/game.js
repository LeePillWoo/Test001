// 2048 게임 로직. DOM에 의존하지 않는 순수 함수만 둔다.
// 브라우저에서는 window.Game2048, Node에서는 module.exports로 쓴다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Game2048 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIZE = 4;
  const WIN_VALUE = 2048;
  const DIRECTIONS = ['up', 'down', 'left', 'right'];

  // state: { size, tiles: [{ id, value, r, c }], score, nextId, won }
  function emptyState(size = SIZE) {
    return { size, tiles: [], score: 0, nextId: 1, won: false };
  }

  function toGrid(state) {
    const grid = Array.from({ length: state.size }, () => Array(state.size).fill(null));
    for (const t of state.tiles) grid[t.r][t.c] = t;
    return grid;
  }

  // 숫자 배열로 보기 (0 = 빈칸). 테스트와 디버깅용.
  function toMatrix(state) {
    return toGrid(state).map((row) => row.map((t) => (t ? t.value : 0)));
  }

  function fromMatrix(matrix) {
    const state = emptyState(matrix.length);
    matrix.forEach((row, r) =>
      row.forEach((value, c) => {
        if (value) state.tiles.push({ id: state.nextId++, value, r, c });
      })
    );
    state.won = state.tiles.some((t) => t.value >= WIN_VALUE);
    return state;
  }

  function emptyCells(state) {
    const grid = toGrid(state);
    const cells = [];
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++) if (!grid[r][c]) cells.push({ r, c });
    return cells;
  }

  // 빈칸 하나에 2(90%) 또는 4(10%)를 놓는다. rng는 [0, 1) 난수 함수.
  function addRandomTile(state, rng = Math.random) {
    const cells = emptyCells(state);
    if (cells.length === 0) return { state, tile: null };
    const { r, c } = cells[Math.floor(rng() * cells.length)];
    const tile = { id: state.nextId, value: rng() < 0.9 ? 2 : 4, r, c };
    return {
      state: { ...state, tiles: [...state.tiles, tile], nextId: state.nextId + 1 },
      tile,
    };
  }

  function newGame(rng = Math.random, size = SIZE) {
    let state = emptyState(size);
    state = addRandomTile(state, rng).state;
    state = addRandomTile(state, rng).state;
    return state;
  }

  // 한 줄(이동 방향 쪽이 앞)의 값을 밀고 합친다. 한 번 합쳐진 칸은 다시 합쳐지지 않는다.
  // slideLine([2, 2, 2, 2]) -> { values: [4, 4, 0, 0], gained: 8 }
  function slideLine(values) {
    const out = [];
    let gained = 0;
    let lastMerged = false;
    for (const v of values) {
      if (!v) continue;
      if (out.length && !lastMerged && out[out.length - 1] === v) {
        out[out.length - 1] = v * 2;
        gained += v * 2;
        lastMerged = true;
      } else {
        out.push(v);
        lastMerged = false;
      }
    }
    while (out.length < values.length) out.push(0);
    return { values: out, gained };
  }

  // 방향별로 각 줄의 칸 좌표를 이동 방향 쪽부터 나열한다.
  function lines(size, dir) {
    const result = [];
    for (let i = 0; i < size; i++) {
      const line = [];
      for (let k = 0; k < size; k++) {
        if (dir === 'left') line.push({ r: i, c: k });
        else if (dir === 'right') line.push({ r: i, c: size - 1 - k });
        else if (dir === 'up') line.push({ r: k, c: i });
        else line.push({ r: size - 1 - k, c: i });
      }
      result.push(line);
    }
    return result;
  }

  // 반환값:
  //   state      이동 후 상태 (새 타일은 아직 추가하지 않음)
  //   moved      실제로 움직이거나 합쳐진 타일이 있었는지
  //   gained     이번 이동으로 얻은 점수
  //   slides     기존 타일의 도착 위치 [{ id, r, c, consumed }]. consumed는 합쳐져 사라지는 타일
  //   merges     합쳐서 새로 생긴 타일 [{ id, value, r, c, from: [id, id] }]
  function move(state, dir) {
    if (!DIRECTIONS.includes(dir)) throw new Error(`알 수 없는 방향: ${dir}`);
    const grid = toGrid(state);
    let nextId = state.nextId;
    let gained = 0;
    let moved = false;
    const tiles = [];
    const slides = [];
    const merges = [];

    for (const line of lines(state.size, dir)) {
      const groups = [];
      for (const { r, c } of line) {
        const tile = grid[r][c];
        if (!tile) continue;
        const last = groups[groups.length - 1];
        if (last && last.sources.length === 1 && last.sources[0].value === tile.value) {
          last.sources.push(tile);
        } else {
          groups.push({ sources: [tile] });
        }
      }

      groups.forEach((group, j) => {
        const { r, c } = line[j];
        if (group.sources.length === 1) {
          const t = group.sources[0];
          if (t.r !== r || t.c !== c) moved = true;
          tiles.push({ id: t.id, value: t.value, r, c });
          slides.push({ id: t.id, r, c, consumed: false });
        } else {
          moved = true;
          const value = group.sources[0].value * 2;
          const merged = { id: nextId++, value, r, c };
          gained += value;
          tiles.push(merged);
          merges.push({ ...merged, from: group.sources.map((t) => t.id) });
          for (const t of group.sources) slides.push({ id: t.id, r, c, consumed: true });
        }
      });
    }

    const next = {
      size: state.size,
      tiles,
      score: state.score + gained,
      nextId,
      won: state.won || tiles.some((t) => t.value >= WIN_VALUE),
    };
    return { state: moved ? next : state, moved, gained, slides, merges };
  }

  function canMove(state) {
    if (state.tiles.length < state.size * state.size) return true;
    const grid = toGrid(state);
    for (let r = 0; r < state.size; r++)
      for (let c = 0; c < state.size; c++) {
        const v = grid[r][c].value;
        if (c + 1 < state.size && grid[r][c + 1].value === v) return true;
        if (r + 1 < state.size && grid[r + 1][c].value === v) return true;
      }
    return false;
  }

  function maxTile(state) {
    return state.tiles.reduce((m, t) => Math.max(m, t.value), 0);
  }

  // 재현 가능한 난수 (테스트, 시드 게임용)
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    SIZE,
    WIN_VALUE,
    DIRECTIONS,
    emptyState,
    newGame,
    addRandomTile,
    slideLine,
    move,
    canMove,
    maxTile,
    emptyCells,
    toMatrix,
    fromMatrix,
    seededRng,
  };
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/game.js');

const moveMatrix = (matrix, dir) => {
  const result = G.move(G.fromMatrix(matrix), dir);
  return { ...result, matrix: G.toMatrix(result.state) };
};

test('slideLine: 빈칸을 당기고 같은 숫자를 합친다', () => {
  assert.deepEqual(G.slideLine([0, 2, 0, 2]), { values: [4, 0, 0, 0], gained: 4 });
  assert.deepEqual(G.slideLine([2, 4, 8, 16]), { values: [2, 4, 8, 16], gained: 0 });
  assert.deepEqual(G.slideLine([0, 0, 0, 0]), { values: [0, 0, 0, 0], gained: 0 });
});

test('slideLine: 한 번 합쳐진 타일은 같은 이동에서 다시 합쳐지지 않는다', () => {
  assert.deepEqual(G.slideLine([2, 2, 2, 2]).values, [4, 4, 0, 0]);
  assert.deepEqual(G.slideLine([4, 4, 8, 0]).values, [8, 8, 0, 0]);
  assert.deepEqual(G.slideLine([2, 2, 4, 0]).values, [4, 4, 0, 0]);
});

test('slideLine: 세 개가 같으면 이동 방향 쪽 두 개가 먼저 합쳐진다', () => {
  assert.deepEqual(G.slideLine([2, 2, 2, 0]).values, [4, 2, 0, 0]);
});

test('move: 네 방향 모두 올바르게 민다', () => {
  const board = [
    [2, 0, 2, 4],
    [0, 0, 0, 0],
    [2, 0, 0, 0],
    [0, 0, 0, 4],
  ];
  assert.deepEqual(moveMatrix(board, 'left').matrix, [
    [4, 4, 0, 0],
    [0, 0, 0, 0],
    [2, 0, 0, 0],
    [4, 0, 0, 0],
  ]);
  assert.deepEqual(moveMatrix(board, 'right').matrix, [
    [0, 0, 4, 4],
    [0, 0, 0, 0],
    [0, 0, 0, 2],
    [0, 0, 0, 4],
  ]);
  assert.deepEqual(moveMatrix(board, 'up').matrix, [
    [4, 0, 2, 8],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(moveMatrix(board, 'down').matrix, [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [4, 0, 2, 8],
  ]);
});

test('move: 점수는 합쳐서 생긴 숫자만큼 오른다', () => {
  const { state, gained } = moveMatrix(
    [
      [2, 2, 4, 4],
      [8, 8, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    'left'
  );
  assert.equal(gained, 4 + 8 + 16);
  assert.equal(state.score, 28);
});

test('move: 아무것도 움직이지 않으면 moved=false이고 상태가 그대로다', () => {
  const start = G.fromMatrix([
    [2, 4, 0, 0],
    [4, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = G.move(start, 'left');
  assert.equal(result.moved, false);
  assert.equal(result.state, start);
});

test('move: 애니메이션용 slides/merges 정보를 돌려준다', () => {
  const start = G.fromMatrix([
    [0, 2, 0, 2],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const [a, b] = start.tiles;
  const { slides, merges, state } = G.move(start, 'left');
  assert.deepEqual(slides, [
    { id: a.id, r: 0, c: 0, consumed: true },
    { id: b.id, r: 0, c: 0, consumed: true },
  ]);
  assert.equal(merges.length, 1);
  assert.deepEqual(merges[0].from, [a.id, b.id]);
  assert.equal(merges[0].value, 4);
  assert.equal(state.tiles.length, 1);
  assert.equal(state.tiles[0].id, merges[0].id);
});

test('move: 원래 상태를 바꾸지 않는다', () => {
  const start = G.fromMatrix([
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const before = JSON.stringify(start);
  G.move(start, 'right');
  assert.equal(JSON.stringify(start), before);
});

test('move: 2048을 만들면 won이 된다', () => {
  const { state } = moveMatrix(
    [
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    'left'
  );
  assert.equal(state.won, true);
  assert.equal(G.maxTile(state), 2048);
});

test('canMove: 빈칸이나 인접한 같은 숫자가 없으면 게임 오버', () => {
  const stuck = G.fromMatrix([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);
  assert.equal(G.canMove(stuck), false);

  const mergeable = G.fromMatrix([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 4],
  ]);
  assert.equal(G.canMove(mergeable), true);

  const withGap = G.fromMatrix([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 0, 4],
    [4, 2, 4, 2],
  ]);
  assert.equal(G.canMove(withGap), true);
});

test('newGame: 타일 두 개로 시작하고 시드가 같으면 결과도 같다', () => {
  const a = G.newGame(G.seededRng(42));
  const b = G.newGame(G.seededRng(42));
  assert.equal(a.tiles.length, 2);
  assert.deepEqual(a, b);
  for (const t of a.tiles) assert.ok(t.value === 2 || t.value === 4);
});

test('addRandomTile: 빈칸이 없으면 아무것도 하지 않는다', () => {
  const full = G.fromMatrix([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);
  const { state, tile } = G.addRandomTile(full);
  assert.equal(tile, null);
  assert.equal(state, full);
});

test('시뮬레이션: 무작위로 끝까지 둬도 규칙이 깨지지 않는다', () => {
  const rng = G.seededRng(7);
  let state = G.newGame(rng);
  for (let i = 0; i < 2000 && G.canMove(state); i++) {
    const dir = G.DIRECTIONS[Math.floor(rng() * 4)];
    const before = state.tiles.reduce((s, t) => s + t.value, 0);
    const result = G.move(state, dir);
    const after = result.state.tiles.reduce((s, t) => s + t.value, 0);
    assert.equal(after, before, '이동 중 숫자 합은 보존된다');
    if (result.moved) state = G.addRandomTile(result.state, rng).state;
    const ids = new Set(state.tiles.map((t) => t.id));
    assert.equal(ids.size, state.tiles.length, '타일 id는 겹치지 않는다');
  }
  assert.equal(G.canMove(state), false);
});

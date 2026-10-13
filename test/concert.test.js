const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../concert/js/core.js');

const CONCERT = path.join(__dirname, '..', 'concert');

test('seededRng: 같은 시드는 같은 수열, 값은 0 이상 1 미만', () => {
  const a = C.seededRng(42);
  const b = C.seededRng(42);
  const xs = Array.from({ length: 1000 }, () => a());
  assert.deepEqual(
    xs,
    Array.from({ length: 1000 }, () => b())
  );
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, C.seededRng(43)));
});

test('rngFor: 이름마다 다른 수열이라 레이어끼리 무늬가 엮이지 않는다', () => {
  assert.equal(C.rngFor(7, 'hair')(), C.rngFor(7, 'hair')());
  assert.notEqual(C.rngFor(7, 'hair')(), C.rngFor(7, 'face')());
});

test('makeNoise2D: 결정적이고 대략 -1..1 범위', () => {
  const n1 = C.makeNoise2D(3);
  const n2 = C.makeNoise2D(3);
  for (let i = 0; i < 500; i++) {
    const x = i * 0.137;
    const y = i * 0.071;
    const v = n1(x, y);
    assert.equal(v, n2(x, y));
    assert.ok(v >= -1.01 && v <= 1.01);
  }
  assert.equal(n1(4, 9), 0); // 격자점에서는 0
});

test('smoothPath: 점마다 곡선 한 마디, 닫힌 경로는 Z로 끝난다', () => {
  const pts = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const open = C.smoothPath(pts);
  assert.match(open, /^M0 0/);
  assert.equal((open.match(/C/g) || []).length, 3);
  const closed = C.smoothPath(pts, true);
  assert.equal((closed.match(/C/g) || []).length, 4);
  assert.ok(closed.endsWith('Z'));
  assert.equal(C.smoothPath([[1, 1]]), '');
});

test('색 도우미: hex ↔ rgb, 섞기', () => {
  assert.deepEqual(C.hexToRgb('#ff4f9a'), [255, 79, 154]);
  assert.deepEqual(C.hexToRgb('#fff'), [255, 255, 255]);
  assert.equal(C.rgbToHex([255, 79, 154]), '#ff4f9a');
  assert.equal(C.mixColor('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(C.rgba('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
});

test('기법 목록: 모든 entry 파일이 있고 id가 겹치지 않는다', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(CONCERT, 'js', 'methods.js'), 'utf8'), sandbox);
  const methods = sandbox.window.ConcertMethods;
  assert.ok(methods.length >= 4);
  assert.equal(new Set(methods.map((m) => m.id)).size, methods.length);
  for (const m of methods) {
    assert.ok(fs.existsSync(path.join(CONCERT, m.entry)), `${m.entry} 없음`);
    assert.ok(m.title && m.uses, `${m.id} 설명 없음`);
  }
});

test('스크립트 문법: concert/js 아래 모든 파일이 브라우저 전역 환경에서 읽힌다', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(CONCERT, 'js'));
  for (const f of files) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }), f);
  }
});

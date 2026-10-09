// 기법 목록. 각 항목의 entry 스크립트가 ConcertCore.define(id, ...)로 자신을 등록한다.
// 순서는 원본에서 얻어 쓰는 정보가 적은 것부터 많은 것 순이다.
window.ConcertMethods = [
  {
    id: 'procedural',
    title: '절차적 드로잉',
    entry: 'js/procedural/index.js',
    short: '도형·그라디언트·노이즈로 직접 그린 일러스트',
    uses: '좌표·윤곽·팔레트만 참고하고, 색칠과 빛은 모두 코드 규칙으로 그린다.',
  },
  {
    id: 'primitives',
    title: '도형 최적화',
    entry: 'js/primitives/index.js',
    short: '반투명 도형 수천 개를 하나씩 최적화',
    uses: '반투명 도형을 하나씩 더하며 원본과의 오차가 가장 줄어드는 위치·크기·색을 찾는다.',
  },
  {
    id: 'strokes',
    title: '붓질 렌더링',
    entry: 'js/strokes/index.js',
    short: '굵은 붓에서 가는 붓으로 덧칠',
    uses: '굵은 붓부터 가는 붓까지 겹쳐 칠한다. 붓질 방향은 원본의 결을 따른다.',
  },
  {
    id: 'neural',
    title: '신경망 기억',
    entry: 'js/neural/index.js',
    short: '좌표를 넣으면 색을 돌려주는 작은 신경망',
    uses: '(x, y) 좌표를 색으로 바꾸는 작은 신경망을 원본에 맞춰 학습시키고, 그 가중치로 화면을 계산한다.',
  },
  {
    id: 'trace',
    title: '벡터 트레이싱',
    entry: 'js/trace/index.js',
    short: '색 영역 8만 개를 곡선 경로로 바꾼 벡터 그림',
    uses: '원본을 색 영역 수만 개(단색·선형 그라디언트)로 나누고, 각 영역의 외곽선을 원본 경계에 1/4px까지 맞춘 곡선으로 바꿔 큰 것부터 쌓아 칠한다.',
  },
];

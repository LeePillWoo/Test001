// 기법 목록. 각 항목의 entry 스크립트가 ConcertCore.define(id, ...)로 자신을 등록한다.
// 순서는 원본에서 얻어 쓰는 정보가 적은 것부터 많은 것 순이다.
window.ConcertMethods = [
  {
    id: 'procedural',
    title: '절차적 드로잉',
    entry: 'js/procedural/index.js',
    uses: '좌표·윤곽·팔레트만 참고하고, 색칠과 빛은 모두 코드 규칙으로 그린다.',
  },
  {
    id: 'primitives',
    title: '도형 최적화',
    entry: 'js/primitives/index.js',
    uses: '반투명 도형을 하나씩 더하며 원본과의 오차가 가장 줄어드는 위치·크기·색을 찾는다.',
  },
  {
    id: 'strokes',
    title: '붓질 렌더링',
    entry: 'js/strokes/index.js',
    uses: '굵은 붓부터 가는 붓까지 겹쳐 칠한다. 붓질 방향은 원본의 결을 따른다.',
  },
  {
    id: 'trace',
    title: '벡터 트레이싱',
    entry: 'js/trace/index.js',
    uses: '색을 몇십 가지로 줄인 뒤 같은 색 영역의 외곽선을 곡선으로 바꾼다.',
  },
];

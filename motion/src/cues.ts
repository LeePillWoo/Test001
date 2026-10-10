// 장면 시간표와 효과음 자리. 숫자는 프레임(30fps). SFX_CUES.md와 같은 값이다.
export const FPS = 30;
export const DURATION = 15 * FPS;

export const T = {
  photoEnd: 90, // 0~3초: 원본 사진 줌인
  pawUp: 96, // 고양이 앞발 들기 시작
  highFive: 132, // 손이 닿는 순간 (4.4초)
  transformStart: 150, // 5초: 파티클 회전 시작
  glowPeak: 240, // 빛이 가장 밝은 순간 (8초) — 이때 의상이 바뀐다
  costumeEnd: 288, // 의상 조각이 모두 나타남
  reveal: 300, // 10초: 마법소녀 등장
  line1: 390, // 13초: 첫 대사
  line2: 408, // 두 번째 대사
  ending: 426, // 엔딩 반짝임
};

// 효과음 자리 (BGM은 따로, 아래 BGM_SRC)
export const SFX_CUES: { frame: number; name: string; note: string }[] = [
  { frame: T.pawUp, name: 'paw-whoosh', note: '고양이 앞발이 올라가는 짧은 휙' },
  { frame: T.highFive, name: 'high-five-sparkle', note: '하이파이브 "짝" + 반짝 폭발' },
  { frame: T.transformStart, name: 'magic-chime-loop', note: '변신 차임 시작 (5초 동안 상승)' },
  { frame: 200, name: 'sparkle-rise', note: '반짝이 소용돌이가 빨라짐' },
  { frame: T.glowPeak, name: 'shine-flash', note: '빛이 가장 밝아지는 "샤라랑"' },
  { frame: 252, name: 'pop-cape', note: '망토 등장 "띵"' },
  { frame: 258, name: 'pop-collar', note: '세일러 칼라 "띵"' },
  { frame: 264, name: 'pop-skirt', note: '치마 "띵"' },
  { frame: 270, name: 'pop-ribbon', note: '큰 리본 "띵"' },
  { frame: 276, name: 'pop-ears', note: '고양이 귀 머리띠 "띵"' },
  { frame: 282, name: 'pop-tail', note: '꼬리 장식 "띵"' },
  { frame: T.reveal, name: 'reveal-tada', note: '등장 "짠!" + 반짝' },
  { frame: T.line1, name: 'line1-twinkle', note: '"반짝반짝 냥냥 파워!" 자막 반짝' },
  { frame: T.line2, name: 'line2-twinkle', note: '두 번째 대사 자막 반짝' },
  { frame: T.ending, name: 'ending-sparkle', note: '엔딩 반짝임 폭발' },
];

// BGM 자리: public/에 음악 파일을 넣고 이름을 적으면 깔린다. 비워 두면 무음.
export const BGM_SRC: string | null = null;

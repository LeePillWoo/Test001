# 반짝반짝 냥냥 파워! — 고양이 마법소녀 변신 (Remotion)

사진 한 장(고양이 옆에서 브이 하는 아이)으로 만든 15초 세로 모션그래픽입니다.
1080×1920, 30fps, 450프레임. 결과물: [`out/nyang-magical-girl.mp4`](out/nyang-magical-girl.mp4)

## 장면

| 시간 | 내용 |
| --- | --- |
| 0~3초 | 원본 사진으로 시작, 천천히 줌인 |
| 3~5초 | 고양이가 앞발을 들어 아이 손과 하이파이브 → 닿는 순간(4.4초) 핑크·금색 빛 폭발 |
| 5~10초 | 반짝이·하트·별이 나선으로 아이를 감싸며 회전, 빛 리본이 감아 올라가고 아이가 빛에 싸인 채 의상이 바뀜 (8초가 가장 밝은 순간) |
| 10~13초 | 고양이 마법소녀 등장 + 포즈 (고양이도 리본을 받음) |
| 13~15초 | 대사 자막 두 줄 + 엔딩 반짝임 |

## 의상 (오리지널 디자인)

흰색·핑크 세일러 칼라, 금색 발바닥 브로치를 단 큰 리본, 라벤더 짧은 망토, 고양이 귀 머리띠,
리본 달린 꼬리 장식, 물결 밑단 2단 주름치마. 소매는 분홍, 바지는 흰 라벤더로 다시 칠했습니다.
특정 애니 캐릭터의 디자인을 따르지 않았습니다.

## 만드는 법

- `tools/cutout.py`: 원본에서 아이와 고양이를 GrabCut으로 오려 `public/child.png`, `public/cat.png`로,
  둘을 지운 배경판을 `public/plate.jpg`로, 변신 후 옷 색을 바꾼 `public/child_magic.png`를 만든다.
- 효과는 모두 코드: 하이파이브 앞발·빛 폭발·파티클·빛 리본·의상은 SVG, 빛에 싸인 아이는 아이 모양 마스크에 빛 그라디언트.
- 자막 글꼴: Jua (`@fontsource/jua`)

```bash
cd motion
npm install
python3 tools/cutout.py        # 레이어 다시 만들기 (opencv-python, numpy 필요)
npm run studio                 # 미리보기
npm run render                 # out/nyang-magical-girl.mp4
```

## 소리

영상에는 소리가 없습니다. 효과음 자리는 [`SFX_CUES.md`](SFX_CUES.md)에 시각·프레임별로 정리했고(`src/cues.ts`가 원본),
BGM은 `src/cues.ts`의 `BGM_SRC`에 파일 이름을 넣으면 깔리도록 자리만 비워 두었습니다.

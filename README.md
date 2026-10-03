# 청자 2048

타일을 밀어서 같은 숫자를 합치는 2048 퍼즐입니다. 타일 색은 청자(초록)에서 청화(파랑)를 거쳐 금채(2048)로 올라갑니다.
빌드 과정이나 의존성 없이 HTML, CSS, JS만으로 만들었습니다.

## 조작

- 키보드: 방향키 또는 `W` `A` `S` `D`
- 모바일: 보드 위에서 스와이프 (PC에서는 마우스 드래그)
- 되돌리기: 버튼 또는 `Z` / `U` 키 (한 단계)
- 진행 중인 판과 최고 점수는 브라우저에 저장됩니다.

## 로컬에서 실행

```bash
npm start          # http://localhost:8080
# 또는 index.html을 브라우저로 바로 열어도 됩니다.
```

## 테스트

```bash
npm test
```

게임 규칙(`src/game.js`)은 DOM과 분리된 순수 함수라서 Node 내장 테스트 러너로 검사합니다.
한 번 합쳐진 타일이 다시 합쳐지지 않는지, 네 방향 이동, 점수 계산, 게임 오버 판정,
무작위 2000수 시뮬레이션에서 숫자 합과 타일 id가 보존되는지 등을 확인합니다.

## 구조

```
index.html          화면 마크업
src/game.js         게임 규칙 (보드 상태, 이동, 합치기, 판정)
src/app.js          렌더링, 애니메이션, 키보드/스와이프 입력, 저장
src/style.css       스타일 (라이트/다크 테마)
test/game.test.js   규칙 테스트
.github/workflows/pages.yml   테스트 후 GitHub Pages 배포
```

## 배포 (GitHub Pages)

1. 저장소 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.
2. `main` 브랜치에 push(또는 PR 머지)하면 테스트를 통과한 뒤 자동 배포됩니다.
3. 주소: `https://<사용자이름>.github.io/<저장소이름>/`

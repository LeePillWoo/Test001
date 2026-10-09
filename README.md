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
test/concert.test.js  concert 공용 도우미·기법 목록·스크립트 문법 테스트
concert/            코드로 그린 무대 (concert/README.md)
.github/workflows/test.yml    push와 PR마다 테스트 실행
```

## 코드로 그린 무대 (`concert/`)

일러스트 한 장을 절차적 드로잉, 도형 최적화, 붓질 렌더링, 벡터 트레이싱, 신경망 기억, 다섯 가지 코드 기법으로
다시 그리고 원본과 비교하는 페이지입니다. 자세한 내용은 [concert/README.md](concert/README.md)에 있습니다.

```bash
npm start          # http://localhost:8080/concert/
```

## 데모

비공개 저장소라서 GitHub Pages 대신 Claude 아티팩트로 띄워 두었습니다.
https://claude.ai/artifact/FpoYdEWn4J9LJqX3v5pvZj

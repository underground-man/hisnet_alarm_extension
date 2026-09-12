# HISNet Stage 1 Login Implementation Plan

> **협업 방식 (일반 writing-plans 문서와 다른 점):** 이 계획은 자동 실행되는 subagent가
> 아니라, 사용자가 직접 코드를 타이핑하고 Claude가 각 단계를 설명·리뷰하는 방식으로
> 진행합니다. 각 태스크마다 "무엇을 왜 쓰는지" 설명 → 사용자가 직접 타이핑 →
> `chrome://extensions` 서비스 워커 콘솔에서 수동 검증 → 커밋 순서로 진행합니다.
> pytest 같은 자동화 테스트 프레임워크는 쓰지 않습니다 — 스펙 문서 ⑥번에서 이미
> "MV3 서비스워커 + 실제 로그인 세션이 필요한 외부 사이트" 특성상 수동 콘솔 검증이
> 더 실용적이라고 결정했습니다.

**Goal:** HISNet에 정상적으로 로그인하고, 성공/실패를 정확히 판별하는
`loginToHisnet(id, password)` 함수를 만든다.

**Architecture:** Manifest V3 서비스 워커(`background.js`) 안에 순수 함수 형태로 구현한다.
로그인 페이지를 GET해서 매번 바뀌는 필드명을 정규식으로 추출하고, 그 필드명으로 POST
바디를 구성해 로그인 요청을 보낸 뒤, 응답 본문에 있는 JS 리다이렉트 유무로 성공/실패를
판별한다.

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, `fetch`,
`TextDecoder("euc-kr")`, `URLSearchParams`.

**Spec:** [docs/superpowers/specs/2026-09-12-hisnet-login-stage1-design.md](../specs/2026-09-12-hisnet-login-stage1-design.md)

## Global Constraints

- 필드명(`id_숫자`, `password_숫자`)은 절대 하드코딩하지 않는다 — 매 로그인 시도마다
  정규식으로 새로 추출한다.
- 모든 HISNet 응답은 `arrayBuffer()` + `TextDecoder("euc-kr")`로 디코딩한다. `.text()`를
  직접 쓰면 UTF-8로 해석되어 한글이 깨진다.
- 로그인 POST에는 반드시 `credentials: 'include'`를 넣는다 — 없으면 세션 쿠키가
  저장되지 않는다.
- 성공 판별은 리다이렉트 목적지 URL이 아니라 `document.location.href` 문자열의
  존재 여부로 한다 (목적지는 상황마다 달라짐 — 설계 문서 참고).

---

### Task 1: 프로젝트 뼈대 + 확장 로드 확인

**Files:**
- Create: `manifest.json`
- Create: `background.js` (빈 파일, 로그만 출력)

**Interfaces:**
- Produces: 없음 (이 태스크는 확장이 크롬에 정상적으로 로드되는지만 확인)

- [ ] **Step 1: `manifest.json` 작성**

이 프로젝트에서 왜 이 필드들이 필요한지: `host_permissions`가 있어야 서비스 워커의
`fetch`가 `hisnet.handong.edu`에 대해 일반적인 CORS 제약 없이 요청을 보낼 수 있습니다
(확장에게 특별히 허용된 origin이기 때문). `background.service_worker`는 MV3에서
백그라운드 로직이 돌아가는 위치입니다.

```json
{
  "manifest_version": 3,
  "name": "HISNet 공지 알림 (dev)",
  "version": "0.1.0",
  "host_permissions": ["https://hisnet.handong.edu/*"],
  "background": {
    "service_worker": "background.js"
  }
}
```

- [ ] **Step 2: `background.js` 작성 (동작 확인용)**

```javascript
console.log("[HISNet ext] service worker loaded");
```

- [ ] **Step 3: 크롬에 확장 로드해서 확인**

1. `chrome://extensions` 접속
2. 우측 상단 "개발자 모드" 켜기
3. "압축해제된 확장 프로그램을 로드합니다" → `manifest.json`이 있는 폴더 선택
4. 에러 없이 로드되는지 확인 (매니페스트 문법 오류가 있으면 여기서 빨간 에러가 뜸)
5. 방금 로드된 카드에서 **"서비스 워커"** 링크 클릭 → DevTools 콘솔이 뜨고
   `"[HISNet ext] service worker loaded"` 로그가 보이는지 확인

Expected: 콘솔에 로그 한 줄이 정확히 찍힌다. 안 뜨면 `background.js` 파일 경로/이름
오타부터 의심.

- [ ] **Step 4: 커밋**

```bash
git add manifest.json background.js
git commit -m "Add extension skeleton with host permission for hisnet.handong.edu"
```

---

### Task 2: 로그인 필드명 추출

**Files:**
- Modify: `background.js`

**Interfaces:**
- Produces: `async function fetchLoginFieldNames()` → `Promise<{idField: string, passwordField: string}>`.
  실패 시(정규식 매치 실패) `Error`를 throw한다.

- [ ] **Step 1: euc-kr 디코딩 함수 작성**

왜 필요한지: HISNet은 옛날 사이트라 응답을 euc-kr로 인코딩해서 보냅니다. `fetch(...).text()`를
바로 쓰면 브라우저가 UTF-8로 잘못 해석해서 한글이 깨집니다. `arrayBuffer()`로 원시
바이트를 받은 다음 `TextDecoder("euc-kr")`로 직접 디코딩해야 합니다.

`background.js`에 추가:

```javascript
async function decodeEucKr(response) {
  const buffer = await response.arrayBuffer();
  return new TextDecoder("euc-kr").decode(buffer);
}
```

- [ ] **Step 2: 필드명 추출 함수 작성**

왜 이렇게 짜는지: 로그인 폼의 실제 필드는 `id_88`, `password_42`처럼 새로고침마다
숫자가 바뀝니다. 정규식으로 현재 페이지에 실제로 존재하는 이름을 찾아야 합니다.

`background.js`에 추가:

```javascript
async function fetchLoginFieldNames() {
  const res = await fetch("https://hisnet.handong.edu/login/login.php");
  const html = await decodeEucKr(res);

  const idMatch = html.match(/name="(id_\d+)"/);
  const pwMatch = html.match(/name="(password_\d+)"/);

  if (!idMatch || !pwMatch) {
    throw new Error("로그인 필드명을 찾지 못했습니다 — 사이트 구조가 바뀌었을 수 있습니다.");
  }

  return { idField: idMatch[1], passwordField: pwMatch[1] };
}
```

- [ ] **Step 3: 콘솔에서 수동 검증**

1. `background.js` 저장 후 `chrome://extensions`에서 해당 확장 카드의 새로고침(⟳) 버튼 클릭
2. "서비스 워커" 링크 다시 클릭해서 콘솔 열기
3. 콘솔에 직접 입력: `await fetchLoginFieldNames()`
4. Expected: `{idField: "id_숫자", passwordField: "password_숫자"}` 형태의 객체가 출력됨.
   실제 사이트를 새로고침해서 눈으로 본 숫자와 비교해서 매번 값이 바뀌는지도 확인해보면
   좋습니다 (같은 세션 안에서도 요청마다 바뀔 수 있음).

- [ ] **Step 4: 커밋**

```bash
git add background.js
git commit -m "Add HISNet login field name extraction"
```

---

### Task 3: 로그인 POST + 성공/실패 판별

**Files:**
- Modify: `background.js`

**Interfaces:**
- Consumes: `fetchLoginFieldNames()` (Task 2), `decodeEucKr(response)` (Task 2)
- Produces: `async function loginToHisnet(id, password)` →
  `Promise<{success: boolean, message: string}>`

- [ ] **Step 1: 로그인 함수 작성**

왜 이렇게 짜는지: `x`, `y`는 실제 브라우저에서 캡처한 이미지 버튼의 부산물 필드라
그대로 재현합니다. `credentials: "include"`가 없으면 로그인에 성공해도 세션 쿠키가
저장되지 않아 다음 요청부터 다시 로그인 안 된 상태가 됩니다. 성공/실패는 응답 본문에
`document.location.href`가 있는지로 판별합니다 (302 리다이렉트가 아니라 JS 리다이렉트
방식이라는 걸 실측으로 확인했었죠).

`background.js`에 추가:

```javascript
async function loginToHisnet(id, password) {
  const { idField, passwordField } = await fetchLoginFieldNames();

  const body = new URLSearchParams({
    part: "",
    f_name: "",
    agree: "",
    Language: "Korean",
    [idField]: id,
    [passwordField]: password,
    x: "1",
    y: "1",
  });

  const res = await fetch("https://hisnet.handong.edu/login/_login.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    credentials: "include",
  });

  const html = await decodeEucKr(res);

  if (html.includes("document.location.href")) {
    return { success: true, message: "로그인 성공" };
  }

  const alertMatch = html.match(/alert\("([^"]*)"\)/);
  return {
    success: false,
    message: alertMatch ? alertMatch[1] : "로그인 실패 (원인 불명 — 응답 본문 확인 필요)",
  };
}
```

- [ ] **Step 2: 실패 케이스 수동 검증**

콘솔에서: `await loginToHisnet("본인아이디", "일부러틀린비밀번호")`

Expected: `{success: false, message: "입력하신 비밀번호가..."}` 형태 — 아까 캡처했던
실제 alert 문구가 그대로 들어있어야 합니다.

- [ ] **Step 3: 성공 케이스 수동 검증**

콘솔에서: `await loginToHisnet("본인아이디", "실제비밀번호")`

Expected: `{success: true, message: "로그인 성공"}`

⚠️ 콘솔에 이 명령을 직접 입력할 때 비밀번호가 DevTools 콘솔 히스토리에 평문으로
남습니다 — 본인 로컬 환경이라 문제는 없지만, 화면 공유 중이라면 주의하세요.

- [ ] **Step 4: 커밋**

```bash
git add background.js
git commit -m "Add HISNet login POST with success/failure detection"
```

---

## 이후 (이 계획의 범위 밖)

Stage 1이 끝나면 세션 쿠키가 저장된 상태이므로, Stage 2(게시판 목록 파싱)부터는 이
세션으로 바로 `list.php` 요청을 보낼 수 있습니다. Stage 2는 별도 스펙/계획으로
진행합니다.

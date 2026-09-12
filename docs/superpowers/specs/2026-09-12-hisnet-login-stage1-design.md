# HISNet 알림 확장 — Stage 1: 로그인 로직 설계

## 배경

HISNet(한동대학교 포털)의 공지사항을 주기적으로 확인해 새 글이 올라오면 크롬 알림을
띄우는 Manifest V3 확장을 만든다. 전체 스펙은 사용자가 작성한
`hisnet_extension_prompt.md`에 정리되어 있으며, 이 문서는 그중 **Stage 1(로그인
로직)만** 실제 네트워크 트래픽을 캡처해 검증하고 설계한 결과다.

전체 프로젝트 구조나 게시판 파싱(Stage 2 이후)은 별도 스펙에서 다룬다.

## 실측으로 확인/정정된 사실

브라우저 DevTools로 실제 로그인 흐름을 캡처해 다음을 확인했다:

1. **사이트는 frameset 구조다.** 최상위 `https://hisnet.handong.edu/`는 frameset이고,
   실제 로그인 폼은 서브 페이지 `https://hisnet.handong.edu/login/login.php`에
   있다. 따라서 필드명을 읽어오려면 루트가 아니라 이 서브 페이지를 GET해야 한다.
2. 로그인 폼의 `action="./_login.php"`는 위 서브 페이지 기준 상대경로이므로
   실제 POST 대상은 **`https://hisnet.handong.edu/login/_login.php`**다.
   (프로젝트 초기 메모에 있던 `/login/_login.php`라는 추정이 맞았고, 필자가
   중간에 "루트 기준"이라 정정했던 것은 프레임 구조를 놓친 오판이었다.)
3. 아이디/비밀번호 input의 `name` 속성은 새로고침마다 `id_88`, `id_42`, `id_94`
   처럼 숫자가 바뀐다 — 접두사(`id_`, `password_`)는 고정, 숫자만 랜덤.
   반드시 매 로그인 시도마다 정규식으로 다시 읽어야 한다.
4. hidden 필드 `part`, `f_name`, `agree`는 항상 빈 문자열로 전송된다.
5. 로그인 버튼은 `name` 속성이 없는 `<input type="image">`다. 이런 경우 브라우저는
   클릭 좌표를 접두사 없이 `x`, `y` 필드로 자동 전송한다. 실제 캡처된 폼 데이터에서
   확인됨 — 로그인 POST에도 `x`, `y`를 포함해야 한다.
6. `saveid` 체크박스는 체크하지 않으면 폼 데이터에 아예 나타나지 않는다(빈 값이 아니라
   필드 자체가 없음) — 그대로 재현, 보내지 않는다.
7. 로그인 POST 응답은 **HTTP 302 리다이렉트가 아니라 200 OK + JS 리다이렉트**다.
   - 성공 시 응답 본문에 `document.location.href = "<원래 가려던 페이지>";`
     스크립트가 포함된다. 목적지 URL은 고정된 `main.php`가 아니라 로그인 전
     사용자가 접근하려던 페이지에 따라 달라진다 — 따라서 "어디로 리다이렉트하는가"가
     아니라 "리다이렉트 스크립트가 있는가"로 성공을 판별해야 한다.
   - 실패 시 응답 본문에 `alert("...일치하지 않습니다...")` +
     `parent.document.location.reload();`가 포함된다.

## 설계

### ① 로그인 페이지 GET (필드명 추출)

```
fetch('https://hisnet.handong.edu/login/login.php')
```
- 응답을 `arrayBuffer()`로 받아 `TextDecoder("euc-kr")`로 디코딩한다 (UTF-8로 읽으면
  한글이 깨진다 — 이 페이지 자체엔 한글 필드명은 없지만 이후 단계와 디코딩 방식을
  통일한다).
- 정규식 `name="(id_\d+)"`, `name="(password_\d+)"`으로 이번 요청 시점의 실제
  필드명을 추출한다.
- 둘 중 하나라도 못 찾으면 사이트 구조 변경으로 간주하고 명확한 에러를 던진다.

### ② POST 바디 구성

| 필드 | 값 |
|---|---|
| part | (빈 문자열) |
| f_name | (빈 문자열) |
| agree | (빈 문자열) |
| Language | Korean |
| [추출한 id 필드명] | 사용자 아이디 |
| [추출한 password 필드명] | 사용자 비밀번호 |
| x | 1 |
| y | 1 |

`saveid`는 포함하지 않는다. `URLSearchParams`로 인코딩한다.

### ③ 로그인 POST

```
fetch('https://hisnet.handong.edu/login/_login.php', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: <위 URLSearchParams>,
  credentials: 'include'
})
```
`credentials: 'include'`가 필수다 — 이게 없으면 세션 쿠키가 저장되지 않아 이후
게시판 조회 요청이 로그인 안 된 상태로 나간다.

응답도 `arrayBuffer()` + `TextDecoder("euc-kr")`로 디코딩한다.

### ④ 성공/실패 판별

- 디코딩한 응답 본문에 `document.location.href` 문자열이 있으면 **성공**.
- 없으면(대개 `alert(` 포함) **실패** — 실패 메시지 텍스트를 추출해 로그로 남긴다
  (알림 문구 안의 실패 횟수 카운트는 Stage 1에서는 파싱하지 않는다 — YAGNI).

### ⑤ 에러 처리 (Stage 1 범위)

- `fetch` 자체가 reject되는 경우(네트워크 오류) → catch해서 로그, 상위로 에러 전파.
- 필드명 추출 실패 → 명확한 에러 메시지와 함께 예외.
- 이 외의 재시도/재로그인 로직은 Stage 7(에러 처리)에서 다룬다 — Stage 1은 "로그인이
  성공했는지 실패했는지 정확히 판별할 수 있는 단일 함수"까지만 만든다.

### ⑥ 테스트 방법

- `background.js`에 로그인 함수(가칭 `loginToHisnet(id, password)`)를 만들고,
  `chrome://extensions` → 서비스 워커 "검사" → 콘솔에서 직접 호출해 성공/실패 로그를
  확인한다. 자동화 테스트 프레임워크는 이 단계에서 도입하지 않는다(Manifest V3
  service worker 환경 특성상 수동 콘솔 테스트가 더 실용적).

## 범위 밖 (다음 스펙에서 다룸)

- 전체 프로젝트 파일 구조, manifest.json 권한
- 게시판 목록 파싱 (Stage 2)
- storage 스키마, 알림, 알람 주기 (Stage 3~5)
- 옵션 UI (Stage 6)
- 세션 만료 시 재로그인, 재시도 로직 (Stage 7)

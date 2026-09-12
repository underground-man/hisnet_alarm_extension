console.log("[HISNet ext] service worker loaded"); // 콘솔창에서 정상적으로 log 가 뜨는지 확인

async function decodeEucKr(response){ //utf-8 한글 깨짐 방지
    const buffer = await response.arrayBuffer();
    return new TextDecoder("euc-kr").decode(buffer);
}

async function fetchLoginFieldNames(){ // 로그인 필드 명 확인 
    const res = await fetch ("https://hisnet.handong.edu/login/login.php");
    const html = await decodeEucKr(res);

    const idMatch = html.match(/name="(id_\d+)"/);
    const pwMatch = html.match(/name="(password_\d+)"/);

    if (!idMatch || !pwMatch){
        throw new Error("로그인 필드명을 찾지 못했습니다 - 사이트 구조 변경 가능성 있음")
    }

    return { idField: idMatch[1], passwordField: pwMatch[1]}; //로그인 필드는 매 접속요청마다 바뀌므로 고정이 아닌 매회마다 새롭게 변경해야함

}

async function loginToHisnet(id, password){
    const {idField, passwordField} = await fetchLoginFieldNames();

    const body = new URLSearchParams(
    {
        part: "",
        f_name: "",
        agree: "",
        Language: "Korean",
        [idField]: id,
        [passwordField]: password,
        x: "1",
        y: "1",
    }
    );

    const res = await fetch("https://hisnet.handong.edu/login/_login.php",{
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        credentials: "include",
    });

    const html = await decodeEucKr(res);

    if (html.includes("document.location.href")){
        return { success: true, message: "로그인성공"};
    }

    const alertMatch = html.match(/alert\("([^"]*)"\)/);
    return {
    success: false,
    message: alertMatch ? alertMatch[1] : "로그인 실패 (원인 불명 — 응답 본문 확인 필요)",
  };


}

// 흔한 HTML 엔티티(named) + 숫자 문자 참조(&#129386; 같은 이모지 포함)를 디코딩한다.
// 서비스 워커에는 DOM이 없어서(document.createElement 같은 트릭 불가) 직접 구현한다.
function decodeHtmlEntities(text) {
  const namedEntities = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
  };

  return text
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => namedEntities[m])
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function parseBoardPosts(html) {
  const rowPattern = /<tr class="tr_basic">[\s\S]*?<\/tr>/g;
  const rows = html.match(rowPattern) || [];

  return rows.map((row) => {
    const linkPattern = /read\.php\?id=(\d+)[^"]*">([^<]*)</g;
    const matches = [...row.matchAll(linkPattern)];

    const id = Number(matches[0][1]);
    const rawTitle = matches[1][2];
    const title = decodeHtmlEntities(rawTitle).trim();

    return { id, title };
  });
}

async function fetchBoardPosts(boardUrl) {
  const res = await fetch(boardUrl, { credentials: "include" });
  const html = await decodeEucKr(res);
  return parseBoardPosts(html);
}

// ===== Stage 3: storage 저장 + 새 글 판별 =====

async function getStoredLastSeenId(boardUrl) {
  const data = await chrome.storage.local.get("lastSeenId");
  const lastSeenId = data.lastSeenId || {};
  return lastSeenId[boardUrl];
}

async function setStoredLastSeenId(boardUrl, id) {
  const data = await chrome.storage.local.get("lastSeenId");
  const lastSeenId = data.lastSeenId || {};
  lastSeenId[boardUrl] = id;
  await chrome.storage.local.set({ lastSeenId });
}

// posts: fetchBoardPosts()가 반환한 {id, title}[] 배열.
// 첫 확인(저장된 값이 없음)이면 알림 없이 현재 최신 id만 기준점으로 저장한다 -
// 그렇지 않으면 기존 글 전체가 "새 글"로 오인식되어 알림이 스팸처럼 쏟아진다.
// posts가 빈 배열이면(파싱 실패 가능성과 게시판이 실제로 비어있는 경우를 구분할
// 수 없으므로) 저장값을 건드리지 않고 그냥 빈 배열을 반환한다.
async function compareAndGetNewPosts(boardUrl, posts) {
  if (posts.length === 0) {
    return [];
  }

  const newestId = Math.max(...posts.map((p) => p.id));
  const previousId = await getStoredLastSeenId(boardUrl);

  if (previousId === undefined) {
    await setStoredLastSeenId(boardUrl, newestId);
    return [];
  }

  const newPosts = posts.filter((p) => p.id > previousId);

  if (newPosts.length > 0) {
    await setStoredLastSeenId(boardUrl, newestId);
  }

  return newPosts;
}

// ===== Stage 4: 알림 생성 + 클릭 시 이동 =====

const NOTIFICATION_ICON = "icons/icon128.png";

function buildReadUrl(boardUrl, postId) {
  const board = new URL(boardUrl).searchParams.get("Board");
  return `https://hisnet.handong.edu/myboard/read.php?id=${postId}&Page=1&Board=${board}`;
}

async function storeNotificationUrl(notificationId, url) {
  const data = await chrome.storage.local.get("notificationUrls");
  const notificationUrls = data.notificationUrls || {};
  notificationUrls[notificationId] = url;
  await chrome.storage.local.set({ notificationUrls });
}

// 서비스 워커는 알림이 화면에 떠있는 동안에도 유휴 상태로 꺼졌다가 다시 켜질 수
// 있다. 그래서 notificationId -> URL 매핑을 메모리 변수가 아니라 chrome.storage에
// 저장해야, 워커가 재시작된 뒤 알림을 클릭해도 어디로 이동할지 잃어버리지 않는다.
async function popNotificationUrl(notificationId) {
  const data = await chrome.storage.local.get("notificationUrls");
  const notificationUrls = data.notificationUrls || {};
  const url = notificationUrls[notificationId];
  delete notificationUrls[notificationId];
  await chrome.storage.local.set({ notificationUrls });
  return url;
}

async function notifyNewPosts(boardName, boardUrl, newPosts) {
  if (newPosts.length === 0) {
    return;
  }

  const newest = newPosts.reduce((max, p) => (p.id > max.id ? p : max), newPosts[0]);
  const message =
    newPosts.length === 1 ? newest.title : `${newest.title} 외 ${newPosts.length - 1}건`;

  const notificationId = `hisnet-${boardUrl}-${Date.now()}`;
  await storeNotificationUrl(notificationId, buildReadUrl(boardUrl, newest.id));

  chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: boardName,
    message,
  });
}

function notifyLoginFailure(message) {
  chrome.notifications.create(`hisnet-login-fail-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: "HISNet 로그인 실패",
    message,
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const url = await popNotificationUrl(notificationId);
  if (url) {
    chrome.tabs.create({ url });
  }
  chrome.notifications.clear(notificationId);
});

// ===== Stage 5: chrome.alarms 주기 실행 =====

const ALARM_NAME = "hisnet-check";
const MIN_INTERVAL_MINUTES = 15;

async function getSettings() {
  const data = await chrome.storage.local.get(["credentials", "boards", "checkIntervalMinutes"]);
  return {
    credentials: data.credentials || null,
    boards: data.boards || [],
    checkIntervalMinutes: data.checkIntervalMinutes || 60,
  };
}

async function setupAlarm() {
  const { checkIntervalMinutes } = await getSettings();
  const interval = Math.max(checkIntervalMinutes, MIN_INTERVAL_MINUTES);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval });
}

// ===== Stage 7: 에러 처리 (재로그인, 재시도) =====

// 네트워크 오류처럼 "다시 시도하면 될 수도 있는" 실패만 재시도한다. 로그인 거부
// (아이디/비번 틀림)처럼 서버가 명확히 응답한 실패는 여기서 재시도하지 않는다 -
// HISNet은 비밀번호 실패 횟수를 세고 있어서(실측으로 확인함), 잘못된 자격증명을
// 반복 재시도하면 계정이 잠길 수 있다.
async function withRetry(fn, retries = 1, delayMs = 2000) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}

// tr_basic 행이 하나도 안 잡히면 사이트 구조 변경일 수도 있지만, 세션이 만료돼서
// 로그인 페이지로 튕겨나간 것일 가능성이 더 크다. 한 번 재로그인 후 다시 시도한다.
async function fetchBoardPostsWithRetry(board, credentials) {
  let posts = await fetchBoardPosts(board.url);

  if (posts.length === 0) {
    console.warn(
      `[HISNet ext] ${board.name}: 글을 하나도 찾지 못함 - 세션 만료 의심, 재로그인 후 재시도`
    );
    const loginResult = await loginToHisnet(credentials.id, credentials.password);
    if (!loginResult.success) {
      throw new Error(`재로그인 실패: ${loginResult.message}`);
    }
    posts = await fetchBoardPosts(board.url);
  }

  return posts;
}

// ===== 안 읽은 새 글 개수 배지 =====
// 알림을 놓쳐도 툴바 아이콘에 숫자가 남아있게 하고, 팝업을 열면(=확인함) 지운다.

// unreadPosts: [{ boardName, title, url }, ...] - 팝업에서 목록으로 보여줄 항목 그대로 저장.
// 배지 숫자는 이 배열의 길이다.
async function getUnreadPosts() {
  const data = await chrome.storage.local.get("unreadPosts");
  return data.unreadPosts || [];
}

async function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

async function addUnreadPosts(entries) {
  const next = (await getUnreadPosts()).concat(entries);
  await chrome.storage.local.set({ unreadPosts: next });
  await updateBadge(next.length);
}

async function clearUnreadPosts() {
  await chrome.storage.local.set({ unreadPosts: [] });
  await updateBadge(0);
}

// 서비스 워커가 (재시작 등으로) 새로 뜰 때마다 저장된 값 기준으로 배지를 다시 그린다.
getUnreadPosts().then((posts) => updateBadge(posts.length));

// ===== 전체 흐름을 묶는 실행 함수 =====

// 알람이 겹치거나("지금 확인" 버튼을 연타하는 등) runCheck이 중복 실행되는 걸 막는다.
// 이 값은 서비스 워커가 살아있는 동안만 유효하지만, 겹쳐 실행되는 상황은 애초에
// "같은 워커 인스턴스가 살아있는 동안 두 번째 트리거가 들어오는" 경우뿐이라 충분하다.
let isRunning = false;

async function recordCheckStatus(success, message) {
  await chrome.storage.local.set({
    lastCheckStatus: { time: Date.now(), success, message },
  });
}

async function runCheck() {
  if (isRunning) {
    console.warn("[HISNet ext] 이미 확인이 진행 중이라 이번 실행은 건너뜁니다.");
    return;
  }
  isRunning = true;

  try {
    const { credentials, boards } = await getSettings();

    if (!credentials || !credentials.id || !credentials.password) {
      const msg = "계정 정보가 설정되지 않았습니다. 옵션 페이지에서 입력해주세요.";
      console.warn(`[HISNet ext] ${msg}`);
      await recordCheckStatus(false, msg);
      return;
    }

    let loginResult;
    try {
      loginResult = await withRetry(() => loginToHisnet(credentials.id, credentials.password), 1);
    } catch (err) {
      const msg = `로그인 요청 자체가 실패함 (네트워크 오류 등): ${err.message}`;
      console.error(`[HISNet ext] ${msg}`);
      await recordCheckStatus(false, msg);
      return;
    }

    if (!loginResult.success) {
      console.error("[HISNet ext] 로그인 실패:", loginResult.message);
      notifyLoginFailure(loginResult.message);
      await recordCheckStatus(false, `로그인 실패: ${loginResult.message}`);
      return;
    }

    let totalNew = 0;
    const boardErrors = [];
    const collectedNewPosts = [];

    for (const board of boards) {
      try {
        const posts = await withRetry(() => fetchBoardPostsWithRetry(board, credentials), 1);
        const newPosts = await compareAndGetNewPosts(board.url, posts);
        await notifyNewPosts(board.name, board.url, newPosts);
        totalNew += newPosts.length;

        for (const post of newPosts) {
          collectedNewPosts.push({
            boardName: board.name,
            title: post.title,
            url: buildReadUrl(board.url, post.id),
          });
        }
      } catch (err) {
        console.error(`[HISNet ext] ${board.name} 확인 중 오류:`, err);
        boardErrors.push(`${board.name}: ${err.message}`);
      }
    }

    const summary =
      boardErrors.length === 0
        ? `${boards.length}개 게시판 확인 완료 (새 글 ${totalNew}건)`
        : `일부 게시판 확인 실패: ${boardErrors.join(", ")}`;

    if (collectedNewPosts.length > 0) {
      await addUnreadPosts(collectedNewPosts);
    }

    await recordCheckStatus(boardErrors.length === 0, summary);
  } finally {
    isRunning = false;
  }
}

// ===== 팝업/옵션 페이지와의 통신 =====
// popup.js, options.js는 background.js의 함수를 직접 호출할 수 없는 별개의 실행
// 컨텍스트라, chrome.runtime.sendMessage로 요청을 보내고 여기서 처리한다.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RUN_CHECK_NOW") {
    runCheck().then(() => sendResponse({ ok: true }));
    return true; // 비동기로 sendResponse를 호출하겠다는 표시 (필수)
  }

  if (message?.type === "TEST_LOGIN") {
    loginToHisnet(message.id, message.password)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, message: err.message }));
    return true;
  }

  if (message?.type === "CONSUME_UNREAD_POSTS") {
    // 팝업이 목록을 읽어가는 것 = "확인함"으로 간주하고 한 번에 반환+비우기를 한다
    // (따로 읽기/지우기를 하면 그 사이에 새 확인이 끼어드는 경쟁 상태가 생길 수 있다).
    getUnreadPosts().then((posts) => {
      clearUnreadPosts().then(() => sendResponse({ posts }));
    });
    return true;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runCheck();
  }
});

// 옵션 페이지에서 확인 주기를 바꾸면 알람을 새 주기로 다시 등록한다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.checkIntervalMinutes) {
    setupAlarm();
  }
});

const DEFAULT_BOARDS = [
  { name: "일반공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001" },
  { name: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" },
  { name: "대학원공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0113" },
];

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["boards", "checkIntervalMinutes"]);

  if (!data.boards) {
    await chrome.storage.local.set({ boards: DEFAULT_BOARDS });
  }
  if (!data.checkIntervalMinutes) {
    await chrome.storage.local.set({ checkIntervalMinutes: 60 });
  }

  await setupAlarm();
  runCheck();
});

// 컴퓨터/브라우저를 껐다 켰을 때 "다음 주기까지 최대 60분 대기"가 아니라, 꺼져있는
// 동안 쌓였을 수도 있는 새 글을 바로 확인하도록 즉시 한 번 실행한다.
chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm();
  runCheck();
});


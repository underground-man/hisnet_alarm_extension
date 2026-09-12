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

function parseBoardPosts(html) {
  const rowPattern = /<tr class="tr_basic">[\s\S]*?<\/tr>/g;
  const rows = html.match(rowPattern) || [];

  return rows.map((row) => {
    const linkPattern = /read\.php\?id=(\d+)[^"]*">([^<]*)</g;
    const matches = [...row.matchAll(linkPattern)];

    const id = Number(matches[0][1]);
    const rawTitle = matches[1][2];
    const title = rawTitle.replace(/&nbsp;/g, " ").trim();

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

// 1x1 투명 PNG. 실제 아이콘 파일 없이도 chrome.notifications의 iconUrl 요구사항을
// 만족시키기 위한 자리표시자 - 나중에 실제 아이콘으로 교체 가능.
const PLACEHOLDER_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
    iconUrl: PLACEHOLDER_ICON,
    title: boardName,
    message,
  });
}

function notifyLoginFailure(message) {
  chrome.notifications.create(`hisnet-login-fail-${Date.now()}`, {
    type: "basic",
    iconUrl: PLACEHOLDER_ICON,
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

// ===== 전체 흐름을 묶는 실행 함수 =====

async function runCheck() {
  const { credentials, boards } = await getSettings();

  if (!credentials || !credentials.id || !credentials.password) {
    console.warn("[HISNet ext] 계정 정보가 설정되지 않았습니다. 옵션 페이지에서 입력해주세요.");
    return;
  }

  let loginResult;
  try {
    loginResult = await withRetry(() => loginToHisnet(credentials.id, credentials.password), 1);
  } catch (err) {
    console.error("[HISNet ext] 로그인 요청 자체가 실패함 (네트워크 오류 등):", err);
    return;
  }

  if (!loginResult.success) {
    console.error("[HISNet ext] 로그인 실패:", loginResult.message);
    notifyLoginFailure(loginResult.message);
    return;
  }

  for (const board of boards) {
    try {
      const posts = await withRetry(() => fetchBoardPostsWithRetry(board, credentials), 1);
      const newPosts = await compareAndGetNewPosts(board.url, posts);
      await notifyNewPosts(board.name, board.url, newPosts);
    } catch (err) {
      console.error(`[HISNet ext] ${board.name} 확인 중 오류:`, err);
    }
  }
}

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

  setupAlarm();
});

chrome.runtime.onStartup.addListener(setupAlarm);


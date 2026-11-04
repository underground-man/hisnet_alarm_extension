importScripts("core.js");

const {
  BOARD_PRESETS,
  clearReadNotices,
  countUnread,
  deleteNotice,
  markNoticeRead,
  mergeNotices,
  normalizeBoard,
  normalizeNotice,
  parseBoardPosts,
  toggleNoticeFavorite,
} = HisnetCore;

console.log("[HISNet ext] service worker loaded"); // 콘솔창에서 정상적으로 log 가 뜨는지 확인

async function decodeEucKr(response){ //utf-8 한글 깨짐 방지
    const buffer = await response.arrayBuffer();
    return new TextDecoder("euc-kr").decode(buffer);
}

async function fetchLoginFieldNames(){ // 로그인 필드 명 확인 
    const res = await fetch ("https://hisnet.handong.edu/login/login.php");
    if (!res.ok) {
        throw new Error(`로그인 페이지 요청 실패 (HTTP ${res.status})`);
    }
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

    if (!res.ok) {
        throw new Error(`로그인 요청 실패 (HTTP ${res.status})`);
    }

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

async function fetchBoardPosts(boardUrl) {
  const res = await fetch(boardUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`게시판 요청 실패 (HTTP ${res.status})`);
  }
  const html = await decodeEucKr(res);
  if (/name=["']id_\d+["']/i.test(html) && /name=["']password_\d+["']/i.test(html)) {
    const error = new Error("게시판 대신 로그인 페이지가 반환되었습니다.");
    error.code = "HISNET_SESSION_EXPIRED";
    throw error;
  }
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
let notificationOperationQueue = Promise.resolve();

function queueNotificationOperation(operation) {
  const result = notificationOperationQueue.then(operation, operation);
  notificationOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function buildReadUrl(boardUrl, postId) {
  const board = new URL(boardUrl).searchParams.get("Board");
  return `https://hisnet.handong.edu/myboard/read.php?id=${postId}&Page=1&Board=${board}`;
}

function storeNotificationUrl(notificationId, url) {
  return queueNotificationOperation(async () => {
    const data = await chrome.storage.local.get("notificationUrls");
    const notificationUrls = data.notificationUrls || {};
    notificationUrls[notificationId] = url;
    await chrome.storage.local.set({ notificationUrls });
  });
}

// 서비스 워커는 알림이 화면에 떠있는 동안에도 유휴 상태로 꺼졌다가 다시 켜질 수
// 있다. 그래서 notificationId -> URL 매핑을 메모리 변수가 아니라 chrome.storage에
// 저장해야, 워커가 재시작된 뒤 알림을 클릭해도 어디로 이동할지 잃어버리지 않는다.
function popNotificationUrl(notificationId) {
  return queueNotificationOperation(async () => {
    const data = await chrome.storage.local.get("notificationUrls");
    const notificationUrls = data.notificationUrls || {};
    const url = notificationUrls[notificationId];
    delete notificationUrls[notificationId];
    await chrome.storage.local.set({ notificationUrls });
    return url;
  });
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

chrome.notifications.onClosed.addListener(async (notificationId) => {
  await popNotificationUrl(notificationId);
});

// ===== Stage 5: chrome.alarms 주기 실행 =====

const ALARM_NAME = "hisnet-check";
const MIN_INTERVAL_MINUTES = 15;

async function getSettings() {
  const data = await chrome.storage.local.get([
    "credentials",
    "boards",
    "checkIntervalMinutes",
    "lastSeenId",
  ]);
  const storedBoards = data.boards || [];
  const boardMigrations = storedBoards.map((stored) => ({
    stored,
    normalized: normalizeBoard(stored, BOARD_PRESETS),
  }));
  const boards = boardMigrations.map(({ normalized }) => normalized).filter(Boolean);
  const storedLastSeenId = data.lastSeenId || {};
  const lastSeenId = { ...storedLastSeenId };

  boardMigrations.forEach(({ stored: storedBoard, normalized: normalizedBoard }) => {
    if (!normalizedBoard || !storedBoard?.url || storedBoard.url === normalizedBoard.url) return;
    if (!Object.prototype.hasOwnProperty.call(lastSeenId, storedBoard.url)) return;

    const checkpoints = [lastSeenId[normalizedBoard.url], lastSeenId[storedBoard.url]]
      .map(Number)
      .filter(Number.isSafeInteger);
    if (checkpoints.length > 0) {
      lastSeenId[normalizedBoard.url] = Math.max(...checkpoints);
    }
    delete lastSeenId[storedBoard.url];
  });

  const updates = {};
  if (JSON.stringify(storedBoards) !== JSON.stringify(boards)) updates.boards = boards;
  if (JSON.stringify(storedLastSeenId) !== JSON.stringify(lastSeenId)) updates.lastSeenId = lastSeenId;
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  return {
    credentials: data.credentials || null,
    boards,
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

// 로그인 페이지로 돌아온 것이 확인된 경우에만 한 번 재로그인한다. 글이 실제로 없는
// 게시판은 정상적인 빈 목록이므로 불필요한 로그인 요청을 만들지 않는다.
async function fetchBoardPostsWithRetry(board, credentials) {
  try {
    return await fetchBoardPosts(board.url);
  } catch (error) {
    if (error.code !== "HISNET_SESSION_EXPIRED") {
      throw error;
    }
    console.warn(
      `[HISNet ext] ${board.name}: 로그인 페이지로 이동됨 - 재로그인 후 재시도`
    );
    const loginResult = await loginToHisnet(credentials.id, credentials.password);
    if (!loginResult.success) {
      throw new Error(`재로그인 실패: ${loginResult.message}`);
    }
    return fetchBoardPosts(board.url);
  }
}

// ===== 공지 보관함 + 읽지 않은 개수 배지 =====
// 저장 키는 이전 버전과의 호환을 위해 unreadPosts를 유지하지만, 이제 읽음/즐겨찾기
// 상태까지 함께 보관한다. 배지는 목록 길이가 아니라 읽지 않은 공지만 센다.
let noticeOperationQueue = Promise.resolve();

function queueNoticeOperation(operation) {
  const result = noticeOperationQueue.then(operation, operation);
  noticeOperationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readNoticePostsUnsafe() {
  const data = await chrome.storage.local.get(["unreadPosts", "boards"]);
  const boards = (data.boards || DEFAULT_BOARDS)
    .map((board) => normalizeBoard(board, BOARD_PRESETS))
    .filter(Boolean);
  const stored = data.unreadPosts || [];
  const normalized = stored.map((post) => normalizeNotice(post, boards));

  if (JSON.stringify(stored) !== JSON.stringify(normalized)) {
    await chrome.storage.local.set({ unreadPosts: normalized });
  }
  return normalized;
}

async function setNoticePostsUnsafe(posts) {
  await chrome.storage.local.set({ unreadPosts: posts });
  await updateBadge(countUnread(posts));
  return posts;
}

function getNoticePosts() {
  return queueNoticeOperation(() => readNoticePostsUnsafe());
}

async function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function addNoticePosts(entries) {
  return queueNoticeOperation(async () =>
    setNoticePostsUnsafe(mergeNotices(await readNoticePostsUnsafe(), entries))
  );
}

function markStoredNoticeRead(url) {
  return queueNoticeOperation(async () =>
    setNoticePostsUnsafe(markNoticeRead(await readNoticePostsUnsafe(), url))
  );
}

function toggleStoredNoticeFavorite(url) {
  return queueNoticeOperation(async () =>
    setNoticePostsUnsafe(toggleNoticeFavorite(await readNoticePostsUnsafe(), url))
  );
}

function deleteStoredNotice(url) {
  return queueNoticeOperation(async () =>
    setNoticePostsUnsafe(deleteNotice(await readNoticePostsUnsafe(), url))
  );
}

function clearStoredReadNotices() {
  return queueNoticeOperation(async () =>
    setNoticePostsUnsafe(clearReadNotices(await readNoticePostsUnsafe()))
  );
}

// 서비스 워커가 (재시작 등으로) 새로 뜰 때마다 저장된 값 기준으로 배지를 다시 그린다.
getNoticePosts().then((posts) => updateBadge(countUnread(posts)));

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
    const knownNoticeUrls = new Set((await getNoticePosts()).map((post) => post.url));

    for (const board of boards) {
      try {
        const posts = await withRetry(() => fetchBoardPostsWithRetry(board, credentials), 1);
        const newPosts = await compareAndGetNewPosts(board.url, posts);
        const notificationPosts = newPosts.filter(
          (post) => !knownNoticeUrls.has(buildReadUrl(board.url, post.id))
        );
        await notifyNewPosts(board.name, board.url, notificationPosts);
        totalNew += notificationPosts.length;

        for (const post of newPosts) {
          const url = buildReadUrl(board.url, post.id);
          collectedNewPosts.push({
            boardName: board.name,
            category: board.category || "기타",
            title: post.title,
            date: post.date,
            url,
            read: false,
            favorite: false,
          });
          knownNoticeUrls.add(url);
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
      await addNoticePosts(collectedNewPosts);
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
  const respond = (operation) => {
    Promise.resolve()
      .then(operation)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  };

  if (message?.type === "RUN_CHECK_NOW") {
    return respond(async () => {
      await runCheck();
      return { ok: true };
    });
  }

  if (message?.type === "TEST_LOGIN") {
    return respond(async () => loginToHisnet(message.id, message.password));
  }

  if (message?.type === "GET_NOTICE_POSTS" || message?.type === "GET_UNREAD_POSTS") {
    return respond(async () => {
      const posts = await getNoticePosts();
      return { ok: true, posts, unreadCount: countUnread(posts) };
    });
  }

  if (message?.type === "MARK_NOTICE_READ") {
    return respond(async () => {
      const posts = await markStoredNoticeRead(message.url);
      return { ok: true, posts, unreadCount: countUnread(posts) };
    });
  }

  if (message?.type === "TOGGLE_NOTICE_FAVORITE") {
    return respond(async () => {
      const posts = await toggleStoredNoticeFavorite(message.url);
      return { ok: true, posts, unreadCount: countUnread(posts) };
    });
  }

  if (message?.type === "DELETE_NOTICE") {
    return respond(async () => {
      const posts = await deleteStoredNotice(message.url);
      return { ok: true, posts, unreadCount: countUnread(posts) };
    });
  }

  if (message?.type === "CLEAR_READ_NOTICES") {
    return respond(async () => {
      const posts = await clearStoredReadNotices();
      return { ok: true, posts, unreadCount: countUnread(posts) };
    });
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
  { category: "일반", name: "일반공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001" },
  { category: "장학공지", name: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" },
  { category: "대학원공지", name: "대학원공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0113" },
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


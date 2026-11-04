const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { TextEncoder, TextDecoder } = require("node:util");
const HisnetCore = require("../core.js");

function response(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

async function loadBackground({ initialStorage = {}, fetchImpl } = {}) {
  const storage = structuredClone(initialStorage);
  const listeners = {};
  const createdNotifications = [];
  const chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === "string") return structuredClone({ [keys]: storage[keys] });
          if (Array.isArray(keys)) {
            return structuredClone(Object.fromEntries(keys.map((key) => [key, storage[key]])));
          }
          return structuredClone(storage);
        },
        set: async (values) => Object.assign(storage, structuredClone(values)),
      },
      onChanged: { addListener: (fn) => { listeners.storageChanged = fn; } },
    },
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {},
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: (fn) => { listeners.alarm = fn; } },
    },
    notifications: {
      create: (id, options) => { createdNotifications.push({ id, options }); },
      clear: () => {},
      onClicked: { addListener: (fn) => { listeners.notificationClicked = fn; } },
      onClosed: { addListener: (fn) => { listeners.notificationClosed = fn; } },
    },
    tabs: { create: () => {} },
    runtime: {
      onMessage: { addListener: (fn) => { listeners.message = fn; } },
      onInstalled: { addListener: (fn) => { listeners.installed = fn; } },
      onStartup: { addListener: (fn) => { listeners.startup = fn; } },
    },
  };
  const context = {
    chrome,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    URL,
    URLSearchParams,
    TextDecoder,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout,
    fetch: fetchImpl || (async () => response("")),
  };
  context.globalThis = context;
  context.importScripts = () => { context.HisnetCore = HisnetCore; };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"),
    context,
    { filename: "background.js" }
  );
  await new Promise((resolve) => setImmediate(resolve));

  async function send(message) {
    return new Promise((resolve, reject) => {
      const keepAlive = listeners.message(message, {}, resolve);
      if (keepAlive !== true) reject(new Error(`message channel not kept alive: ${message.type}`));
      setTimeout(() => reject(new Error(`message timed out: ${message.type}`)), 1000);
    });
  }

  return { storage, listeners, createdNotifications, send };
}

test("normalizes legacy notices through GET_NOTICE_POSTS", async () => {
  const url = "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE";
  const app = await loadBackground({
    initialStorage: {
      boards: [{ name: "장학공지", category: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" }],
      unreadPosts: [{ boardName: "장학공지", title: "안내", date: "", url }],
    },
  });

  const result = await app.send({ type: "GET_NOTICE_POSTS" });
  assert.equal(result.ok, true);
  assert.equal(result.unreadCount, 1);
  assert.equal(result.posts[0].read, false);
  assert.equal(result.posts[0].favorite, false);
  assert.equal(result.posts[0].category, "장학공지");
});

test("persists read and favorite notice mutations", async () => {
  const url = "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE";
  const app = await loadBackground({
    initialStorage: {
      unreadPosts: [{ boardName: "장학공지", category: "장학공지", title: "안내", date: "", url, read: false, favorite: false }],
    },
  });

  const readResult = await app.send({ type: "MARK_NOTICE_READ", url });
  assert.equal(readResult.posts[0].read, true);
  assert.equal(readResult.unreadCount, 0);
  const favoriteResult = await app.send({ type: "TOGGLE_NOTICE_FAVORITE", url });
  assert.equal(favoriteResult.posts[0].favorite, true);
  assert.equal(app.storage.unreadPosts[0].favorite, true);
});

test("persists deletion of an unread favorite notice", async () => {
  const firstUrl = "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=JANG_NOTICE";
  const secondUrl = "https://hisnet.handong.edu/myboard/read.php?id=10&Page=1&Board=JANG_NOTICE";
  const app = await loadBackground({
    initialStorage: {
      unreadPosts: [
        { boardName: "장학공지", category: "장학공지", title: "삭제 대상", date: "", url: firstUrl, read: false, favorite: true },
        { boardName: "장학공지", category: "장학공지", title: "유지 대상", date: "", url: secondUrl, read: false, favorite: false },
      ],
    },
  });

  const result = await app.send({ type: "DELETE_NOTICE", url: firstUrl });
  assert.equal(result.ok, true);
  assert.equal(result.unreadCount, 1);
  assert.deepEqual(result.posts.map((post) => post.url), [secondUrl]);
  assert.deepEqual(app.storage.unreadPosts.map((post) => post.url), [secondUrl]);
});

test("serializes concurrent read and favorite mutations", async () => {
  const url = "https://hisnet.handong.edu/myboard/read.php?id=10&Page=1&Board=JANG_NOTICE";
  const app = await loadBackground({
    initialStorage: {
      unreadPosts: [{ boardName: "장학공지", category: "장학공지", title: "안내", date: "", url, read: false, favorite: false }],
    },
  });

  await Promise.all([
    app.send({ type: "MARK_NOTICE_READ", url }),
    app.send({ type: "TOGGLE_NOTICE_FAVORITE", url }),
  ]);
  assert.equal(app.storage.unreadPosts[0].read, true);
  assert.equal(app.storage.unreadPosts[0].favorite, true);
});

test("restores a legacy preset category without opening options", async () => {
  const app = await loadBackground({
    initialStorage: {
      boards: [{ name: "AI컴퓨터전자공학부", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0029" }],
      unreadPosts: [{ boardName: "AI컴퓨터전자공학부", title: "학부 안내", date: "", url: "u2" }],
    },
  });
  const result = await app.send({ type: "GET_NOTICE_POSTS" });
  assert.equal(result.posts[0].category, "학부공지");
});

test("migrates a legacy board checkpoint before checking for newer posts", async () => {
  const legacyBoardUrl = "https://hisnet.handong.edu/myboard/list.php?Page=1&Board=NB0001";
  const canonicalBoardUrl = "https://hisnet.handong.edu/myboard/list.php?Board=NB0001";
  const boardHtml = '<tr class="tr_basic"><td><a href="read.php?id=9&Board=NB0001">new notice</a></td><td><div align="center">2026-11-04</div></td></tr>';
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/login.php")) return response('name="id_1" name="password_1"');
    if (url.endsWith("/login/_login.php")) return response("document.location.href");
    if (url === canonicalBoardUrl) return response(boardHtml);
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await loadBackground({
    initialStorage: {
      credentials: { id: "student", password: "secret" },
      boards: [{ name: "일반공지", category: "일반", url: legacyBoardUrl }],
      lastSeenId: { [legacyBoardUrl]: 8 },
    },
    fetchImpl,
  });

  await app.send({ type: "RUN_CHECK_NOW" });
  assert.equal(app.storage.lastSeenId[canonicalBoardUrl], 9);
  assert.equal(app.storage.lastSeenId[legacyBoardUrl], undefined);
  assert.deepEqual(app.storage.unreadPosts.map((post) => post.title), ["new notice"]);
});

test("notification close removes its stored URL", async () => {
  const app = await loadBackground({
    initialStorage: { notificationUrls: { notice1: "https://hisnet.handong.edu/post" } },
  });

  assert.equal(typeof app.listeners.notificationClosed, "function");
  await app.listeners.notificationClosed("notice1");
  assert.deepEqual(app.storage.notificationUrls, {});
});

test("serializes concurrent notification URL cleanup", async () => {
  const app = await loadBackground({
    initialStorage: {
      notificationUrls: {
        notice1: "https://hisnet.handong.edu/post/1",
        notice2: "https://hisnet.handong.edu/post/2",
      },
    },
  });

  await Promise.all([
    app.listeners.notificationClosed("notice1"),
    app.listeners.notificationClosed("notice2"),
  ]);
  assert.deepEqual(app.storage.notificationUrls, {});
});

test("records a failed check when a board response is not OK", async () => {
  const boardUrl = "https://hisnet.handong.edu/myboard/list.php?Board=NB0001";
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/login.php")) return response('name="id_1" name="password_1"');
    if (url.endsWith("/login/_login.php")) return response("document.location.href");
    if (url === boardUrl) return response("server error", { ok: false, status: 500 });
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await loadBackground({
    initialStorage: {
      credentials: { id: "student", password: "secret" },
      boards: [{ name: "일반공지", category: "일반", url: boardUrl }],
    },
    fetchImpl,
  });

  const result = await app.send({ type: "RUN_CHECK_NOW" });
  assert.equal(result.ok, true);
  assert.equal(app.storage.lastCheckStatus.success, false);
  assert.match(app.storage.lastCheckStatus.message, /HTTP 500/);
});

test("reports failure when a board remains on the login page after reauthentication", async () => {
  const boardUrl = "https://hisnet.handong.edu/myboard/list.php?Board=NB0001";
  const loginForm = 'name="id_99" name="password_99"';
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/login.php")) return response(loginForm);
    if (url.endsWith("/login/_login.php")) return response("document.location.href");
    if (url === boardUrl) return response(`<html>${loginForm}</html>`);
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await loadBackground({
    initialStorage: {
      credentials: { id: "student", password: "secret" },
      boards: [{ name: "일반공지", category: "일반", url: boardUrl }],
    },
    fetchImpl,
  });

  await app.send({ type: "RUN_CHECK_NOW" });
  assert.equal(app.storage.lastCheckStatus.success, false);
  assert.match(app.storage.lastCheckStatus.message, /로그인 페이지/);
});

test("accepts a real empty board page as a successful check", async () => {
  const boardUrl = "https://hisnet.handong.edu/myboard/list.php?Board=EMPTY";
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/login.php")) return response('name="id_1" name="password_1"');
    if (url.endsWith("/login/_login.php")) return response("document.location.href");
    if (url === boardUrl) return response("<html><table></table></html>");
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await loadBackground({
    initialStorage: {
      credentials: { id: "student", password: "secret" },
      boards: [{ name: "빈 게시판", category: "기타", url: boardUrl }],
    },
    fetchImpl,
  });

  await app.send({ type: "RUN_CHECK_NOW" });
  assert.equal(app.storage.lastCheckStatus.success, true);
});

test("does not notify again for a rediscovered notice already in the library", async () => {
  const boardUrl = "https://hisnet.handong.edu/myboard/list.php?Board=NB0001";
  const readUrl = "https://hisnet.handong.edu/myboard/read.php?id=9&Page=1&Board=NB0001";
  const boardHtml = '<tr class="tr_basic"><td><a href="read.php?id=9&Board=NB0001">기존 공지</a></td><td><div align="center">2026-10-26</div></td></tr>';
  const fetchImpl = async (url) => {
    if (url.endsWith("/login/login.php")) return response('name="id_1" name="password_1"');
    if (url.endsWith("/login/_login.php")) return response("document.location.href");
    if (url === boardUrl) return response(boardHtml);
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await loadBackground({
    initialStorage: {
      credentials: { id: "student", password: "secret" },
      boards: [{ name: "일반공지", category: "일반", url: boardUrl }],
      lastSeenId: { [boardUrl]: 1 },
      unreadPosts: [{ boardName: "일반공지", category: "일반", title: "기존 공지", date: "", url: readUrl, read: true, favorite: true }],
    },
    fetchImpl,
  });

  await app.send({ type: "RUN_CHECK_NOW" });
  assert.equal(app.createdNotifications.length, 0);
  assert.equal(app.storage.unreadPosts[0].favorite, true);
  assert.equal(app.storage.unreadPosts[0].read, true);
});

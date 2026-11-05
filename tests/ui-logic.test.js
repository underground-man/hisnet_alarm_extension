const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareCustomBoard } = require("../core.js");

function loadActions() {
  delete require.cache[require.resolve("../ui-actions.js")];
  return require("../ui-actions.js");
}

test("persists read state before opening an inactive tab", async () => {
  const { openNoticeInBackground } = loadActions();
  const calls = [];
  const sendMessage = async (message) => {
    calls.push(["message", message]);
    return { ok: true, posts: [] };
  };
  const createTab = async (options) => {
    calls.push(["tab", options]);
  };

  await openNoticeInBackground({ url: "https://hisnet.handong.edu/post" }, sendMessage, createTab);

  assert.deepEqual(calls, [
    ["message", { type: "MARK_NOTICE_READ", url: "https://hisnet.handong.edu/post" }],
    ["tab", { url: "https://hisnet.handong.edu/post", active: false }],
  ]);
});

test("does not open a tab when read persistence fails", async () => {
  const { openNoticeInBackground } = loadActions();
  let opened = false;
  await assert.rejects(
    () => openNoticeInBackground(
      { url: "u1" },
      async () => ({ ok: false, message: "저장 실패" }),
      async () => { opened = true; }
    ),
    /저장 실패/
  );
  assert.equal(opened, false);
});

test("favorite action sends the notice URL", async () => {
  const { toggleFavorite } = loadActions();
  const messages = [];
  await toggleFavorite("u1", async (message) => {
    messages.push(message);
    return { ok: true, posts: [] };
  });
  assert.deepEqual(messages, [{ type: "TOGGLE_NOTICE_FAVORITE", url: "u1" }]);
});

test("delete action sends the notice URL", async () => {
  const { deleteNotice } = loadActions();
  const messages = [];
  await deleteNotice("u1", async (message) => {
    messages.push(message);
    return { ok: true, posts: [] };
  });
  assert.deepEqual(messages, [{ type: "DELETE_NOTICE", url: "u1" }]);
});

test("delete action explains how to recover when an old background worker returns no response", async () => {
  const { deleteNotice } = loadActions();
  await assert.rejects(
    () => deleteNotice("u1", async () => undefined),
    /chrome:\/\/extensions.*새로고침/
  );
});

test("custom board preparation rejects a normalized duplicate", () => {
  const existing = [{
    category: "일반",
    name: "일반공지",
    url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001",
  }];
  const result = prepareCustomBoard(
    "중복",
    "https://hisnet.handong.edu/myboard/list.php?Page=3&Board=NB0001",
    existing
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /이미 추가/);
});

test("custom board preparation assigns 기타 category", () => {
  const result = prepareCustomBoard(
    "동아리공지",
    "https://hisnet.handong.edu/myboard/list.php?Board=CLUB",
    []
  );
  assert.deepEqual(result, {
    ok: true,
    board: {
      category: "기타",
      name: "동아리공지",
      url: "https://hisnet.handong.edu/myboard/list.php?Board=CLUB",
    },
  });
});

(function (root, factory) {
  const api = factory();
  root.HisnetUiActions = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function ensureSuccess(response) {
    if (!response?.ok) {
      throw new Error(response?.message || "요청을 처리하지 못했습니다.");
    }
    return response;
  }

  async function openNoticeInBackground(post, sendMessage, createTab) {
    const response = ensureSuccess(await sendMessage({ type: "MARK_NOTICE_READ", url: post.url }));
    await createTab({ url: post.url, active: false });
    return response;
  }

  async function toggleFavorite(url, sendMessage) {
    return ensureSuccess(await sendMessage({ type: "TOGGLE_NOTICE_FAVORITE", url }));
  }

  async function deleteNotice(url, sendMessage) {
    return ensureSuccess(await sendMessage({ type: "DELETE_NOTICE", url }));
  }

  async function clearRead(sendMessage) {
    return ensureSuccess(await sendMessage({ type: "CLEAR_READ_NOTICES" }));
  }

  return { openNoticeInBackground, toggleFavorite, deleteNotice, clearRead };
});

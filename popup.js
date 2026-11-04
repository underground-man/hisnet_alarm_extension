let allPosts = [];
let activeFilter = "전체";

function formatRelativeTime(timestamp) {
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.round(diffHour / 24)}일 전`;
}

function renderSubtitle(lastCheckStatus) {
  const el = document.getElementById("subtitle");

  if (!lastCheckStatus) {
    el.textContent = "아직 확인 기록이 없습니다.";
    el.classList.remove("fail");
    return;
  }

  const time = formatRelativeTime(lastCheckStatus.time);
  el.textContent = lastCheckStatus.success ? `${time} 확인 · 정상` : `${time} 확인 · 오류`;
  el.classList.toggle("fail", !lastCheckStatus.success);
}

async function renderFooter() {
  const data = await chrome.storage.local.get("boards");
  const count = (data.boards || []).length;
  document.getElementById("boardCount").textContent = `게시판 ${count}개 감시 중`;
}

async function loadStatus() {
  const data = await chrome.storage.local.get("lastCheckStatus");
  renderSubtitle(data.lastCheckStatus);
}

function showActionStatus(message, isError = false) {
  const el = document.getElementById("actionStatus");
  el.textContent = message;
  el.classList.toggle("fail", isError);
}

function renderFilters() {
  const filterList = document.getElementById("filterList");
  const filters = HisnetCore.getNoticeFilters(allPosts);
  activeFilter = HisnetCore.resolveNoticeFilter(allPosts, activeFilter);
  filterList.innerHTML = "";
  filters.forEach((filter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-btn";
    button.classList.toggle("active", filter === activeFilter);
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(filter === activeFilter));
    button.textContent = filter;
    button.addEventListener("click", () => {
      activeFilter = filter;
      renderNotices();
    });
    filterList.appendChild(button);
  });
  filterList.hidden = allPosts.length === 0;
}

function renderNotices() {
  const listHeader = document.getElementById("listHeader");
  const list = document.getElementById("newPostsList");
  const emptyState = document.getElementById("emptyState");
  const countLabel = document.getElementById("noticeCountLabel");

  renderFilters();
  const posts = HisnetCore.filterNotices(allPosts, activeFilter);

  if (posts.length === 0) {
    listHeader.hidden = allPosts.length === 0;
    if (allPosts.length > 0) countLabel.textContent = "공지 0건";
    list.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = allPosts.length === 0 ? "새 글이 없습니다." : "이 분류에 표시할 공지가 없습니다.";
    return;
  }

  countLabel.textContent = `공지 ${posts.length}건`;
  list.innerHTML = "";

  posts.forEach((post) => {
    const li = document.createElement("li");
    li.classList.toggle("read", post.read === true);

    const bar = document.createElement("div");
    bar.className = "unread-bar";

    const content = document.createElement("div");
    content.className = "post-content";

    const link = document.createElement("a");
    link.href = "#";

    const meta = document.createElement("span");
    meta.className = "post-meta";
    meta.textContent = post.date ? `${post.boardName} · ${post.date}` : post.boardName;
    if (post.read) {
      const readLabel = document.createElement("span");
      readLabel.className = "read-label";
      readLabel.textContent = "읽음";
      meta.appendChild(readLabel);
    }

    link.appendChild(meta);
    link.appendChild(document.createTextNode(post.title));
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const response = await HisnetUiActions.openNoticeInBackground(
          post,
          (message) => chrome.runtime.sendMessage(message),
          (options) => chrome.tabs.create(options)
        );
        allPosts = response.posts;
        showActionStatus("읽음으로 표시하고 백그라운드 새 탭에 열었습니다.");
        renderNotices();
      } catch (error) {
        showActionStatus(error.message, true);
      }
    });

    content.appendChild(link);

    const favoriteBtn = document.createElement("button");
    favoriteBtn.className = "favorite-btn";
    favoriteBtn.classList.toggle("active", post.favorite === true);
    favoriteBtn.textContent = post.favorite ? "★" : "☆";
    favoriteBtn.title = post.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가";
    favoriteBtn.setAttribute("aria-label", `${post.title} ${favoriteBtn.title}`);
    favoriteBtn.setAttribute("aria-pressed", String(post.favorite === true));
    favoriteBtn.addEventListener("click", async () => {
      try {
        const response = await HisnetUiActions.toggleFavorite(
          post.url,
          (message) => chrome.runtime.sendMessage(message)
        );
        allPosts = response.posts;
        showActionStatus(post.favorite ? "즐겨찾기에서 해제했습니다." : "즐겨찾기에 저장했습니다.");
        renderNotices();
      } catch (error) {
        showActionStatus(error.message, true);
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "🗑";
    deleteBtn.title = "공지 삭제";
    deleteBtn.setAttribute("aria-label", `${post.title} 삭제`);
    deleteBtn.addEventListener("click", async () => {
      try {
        const response = await HisnetUiActions.deleteNotice(
          post.url,
          (message) => chrome.runtime.sendMessage(message)
        );
        allPosts = response.posts;
        showActionStatus("공지를 삭제했습니다.");
        renderNotices();
      } catch (error) {
        showActionStatus(error.message, true);
      }
    });

    const actions = document.createElement("div");
    actions.className = "post-actions";
    actions.appendChild(favoriteBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(bar);
    li.appendChild(content);
    li.appendChild(actions);
    list.appendChild(li);
  });

  listHeader.hidden = false;
  list.hidden = false;
  emptyState.hidden = true;
}

async function loadNewPosts() {
  const response = await chrome.runtime.sendMessage({ type: "GET_NOTICE_POSTS" });
  if (!response?.ok) throw new Error(response?.message || "공지 목록을 불러오지 못했습니다.");
  allPosts = response.posts || [];
  renderNotices();
}

async function clearRead() {
  try {
    const response = await HisnetUiActions.clearRead((message) => chrome.runtime.sendMessage(message));
    allPosts = response.posts;
    showActionStatus("읽은 공지를 지웠습니다. 즐겨찾기는 유지됩니다.");
    renderNotices();
  } catch (error) {
    showActionStatus(error.message, true);
  }
}

async function refresh() {
  const btn = document.getElementById("refreshBtn");
  btn.classList.add("spinning");
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: "RUN_CHECK_NOW" });
    if (!response?.ok) throw new Error(response?.message || "새로고침에 실패했습니다.");
    await loadStatus();
    await loadNewPosts();
    await renderFooter();
    showActionStatus("");
  } catch (error) {
    showActionStatus(error.message, true);
  } finally {
    btn.classList.remove("spinning");
    btn.disabled = false;
  }
}

document.getElementById("refreshBtn").addEventListener("click", refresh);
document.getElementById("clearReadBtn").addEventListener("click", clearRead);
document.getElementById("openOptionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadStatus();
loadNewPosts().catch((error) => showActionStatus(error.message, true));
renderFooter();

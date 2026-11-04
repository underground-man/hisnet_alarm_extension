const DEFAULT_BOARDS = [
  { category: "일반", name: "일반공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=NB0001" },
  { category: "장학공지", name: "장학공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=JANG_NOTICE" },
  { category: "대학원공지", name: "대학원공지", url: "https://hisnet.handong.edu/myboard/list.php?Board=B0113" },
];

const PRESET_BOARDS = HisnetCore.BOARD_PRESETS;
let currentBoards = [];

function showSettingsMessage(message, isError = false) {
  const statusMsg = document.getElementById("statusMsg");
  statusMsg.textContent = message;
  statusMsg.style.color = isError ? "#b00020" : "#1a7a1a";
}

function renderStatus(lastCheckStatus) {
  const box = document.getElementById("statusBox");

  if (!lastCheckStatus) {
    box.textContent = "아직 확인 기록이 없습니다.";
    box.style.color = "#888";
    return;
  }

  const time = new Date(lastCheckStatus.time).toLocaleString("ko-KR");
  box.textContent = `${lastCheckStatus.success ? "✅ 정상" : "❌ 오류"} · ${time}`;
  box.style.color = lastCheckStatus.success ? "#1a7a1a" : "#b00020";
}

async function loadSettings() {
  const data = await chrome.storage.local.get([
    "credentials",
    "boards",
    "checkIntervalMinutes",
    "lastCheckStatus",
  ]);

  document.getElementById("loginId").value = data.credentials?.id || "";
  document.getElementById("loginPassword").value = data.credentials?.password || "";
  document.getElementById("intervalMinutes").value = data.checkIntervalMinutes || 60;

  currentBoards = (data.boards || DEFAULT_BOARDS)
    .map((board) => HisnetCore.normalizeBoard(board, PRESET_BOARDS))
    .filter(Boolean);
  renderBoardList();
  renderStatus(data.lastCheckStatus);
}

async function testLogin() {
  const id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPassword").value;
  const resultEl = document.getElementById("testLoginResult");

  if (!id || !password) {
    resultEl.textContent = "아이디와 비밀번호를 먼저 입력해주세요.";
    resultEl.style.color = "#b00020";
    return;
  }

  const button = document.getElementById("testLoginBtn");
  resultEl.textContent = "테스트 중...";
  resultEl.style.color = "#666";
  button.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_LOGIN", id, password });
    resultEl.textContent = result.success ? "✅ 로그인 성공" : `❌ ${result.message}`;
    resultEl.style.color = result.success ? "#1a7a1a" : "#b00020";
  } catch (error) {
    resultEl.textContent = `❌ ${error.message}`;
    resultEl.style.color = "#b00020";
  } finally {
    button.disabled = false;
  }
}

function renderBoardList() {
  const list = document.getElementById("boardList");
  list.innerHTML = "";

  currentBoards.forEach((board, index) => {
    const li = document.createElement("li");

    const info = document.createElement("div");
    info.className = "board-info";

    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = board.name;

    const url = document.createElement("span");
    url.className = "board-url";
    url.textContent = board.url;

    info.appendChild(name);
    info.appendChild(url);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `${board.name} 삭제`);
    deleteBtn.title = "삭제";
    deleteBtn.addEventListener("click", () => {
      currentBoards.splice(index, 1);
      renderBoardList();
    });

    li.appendChild(info);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  renderPresetSelect();
}

// 이미 추가된 게시판은 목록에서 빼고, 아직 안 넣은 것만 선택지로 보여준다.
function renderPresetSelect() {
  const select = document.getElementById("presetBoardSelect");
  const addedUrls = new Set(currentBoards.map((b) => b.url));
  const available = PRESET_BOARDS.filter((b) => !addedUrls.has(b.url));

  select.innerHTML = "";

  if (available.length === 0) {
    const option = document.createElement("option");
    option.textContent = "추가 가능한 게시판이 없습니다";
    select.appendChild(option);
    select.disabled = true;
    document.getElementById("addPresetBtn").disabled = true;
    return;
  }

  select.disabled = false;
  document.getElementById("addPresetBtn").disabled = false;

  const categories = [...new Set(available.map((b) => b.category))];
  categories.forEach((category) => {
    const group = document.createElement("optgroup");
    group.label = category;

    available
      .filter((b) => b.category === category)
      .forEach((board) => {
        const option = document.createElement("option");
        option.value = board.url;
        option.textContent = board.name;
        group.appendChild(option);
      });

    select.appendChild(group);
  });
}

function addPresetBoard() {
  const select = document.getElementById("presetBoardSelect");
  const board = PRESET_BOARDS.find((b) => b.url === select.value);
  if (!board) return;

  currentBoards.push({ ...board });
  renderBoardList();
}

function addBoard() {
  const nameInput = document.getElementById("newBoardName");
  const urlInput = document.getElementById("newBoardUrl");

  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  const result = HisnetCore.prepareCustomBoard(name, url, currentBoards);
  if (!result.ok) {
    showSettingsMessage(result.message, true);
    return;
  }

  currentBoards.push(result.board);
  nameInput.value = "";
  urlInput.value = "";
  renderBoardList();
}

async function saveSettings() {
  const id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPassword").value;
  let intervalMinutes = Number(document.getElementById("intervalMinutes").value);

  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 15) {
    intervalMinutes = 15;
    document.getElementById("intervalMinutes").value = 15;
  }

  const saveBtn = document.getElementById("saveBtn");
  saveBtn.disabled = true;
  try {
    await chrome.storage.local.set({
      credentials: { id, password },
      boards: currentBoards,
      checkIntervalMinutes: intervalMinutes,
    });
    showSettingsMessage("저장되었습니다.");
    setTimeout(() => showSettingsMessage(""), 2000);
  } catch (error) {
    showSettingsMessage(`저장 실패: ${error.message}`, true);
  } finally {
    saveBtn.disabled = false;
  }
}

document.getElementById("addBoardBtn").addEventListener("click", addBoard);
document.getElementById("addPresetBtn").addEventListener("click", addPresetBoard);
document.getElementById("saveBtn").addEventListener("click", saveSettings);
document.getElementById("testLoginBtn").addEventListener("click", testLogin);

document.getElementById("toggleCustomBtn").addEventListener("click", () => {
  const row = document.getElementById("customAddRow");
  const btn = document.getElementById("toggleCustomBtn");
  const showing = !row.hidden;
  row.hidden = showing;
  btn.textContent = showing ? "직접 URL로 추가하기" : "닫기";
});

loadSettings();

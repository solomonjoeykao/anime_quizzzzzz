const categoryDetails = {
  music: { title: "聽歌猜動畫", eyebrow: "AUDIO CHALLENGE", icon: "♫" },
  image: { title: "看圖猜動畫", eyebrow: "IMAGE CHALLENGE", icon: "▧" },
  silhouette: { title: "角色剪影猜猜看", eyebrow: "WHO'S THAT CHARACTER?", icon: "♟" },
};

const elements = Object.fromEntries([
  "admin-toggle", "admin-panel", "close-admin", "question-form", "category", "youtube-url",
  "question-image", "silhouette-image", "answer", "duration", "youtube-field", "image-field",
  "silhouette-field", "duration-field", "image-preview", "silhouette-preview", "form-title",
  "save-question", "cancel-edit", "form-message", "question-list", "bank-total", "question-count",
  "game-overlay", "back-to-categories", "close-game", "game-counter", "game-category-icon",
  "game-eyebrow", "game-title", "empty-round", "empty-admin", "youtube-stage", "image-stage",
  "silhouette-stage", "game-image", "game-silhouette", "answer-reveal", "answer-text",
  "audio-controls", "play-audio", "pause-audio", "timer-label", "reveal-answer", "next-question",
  "game-hint", "audio-art", "toast",
].map((id) => [id.replace(/-([a-z])/g, (_, character) => character.toUpperCase()), document.getElementById(id)]));

let questions = [];
let activeFilter = "all";
let editingId = null;
let selectedImage = null;
let selectedSilhouette = null;
let gameQuestions = [];
let gameCategory = null;
let gameIndex = 0;
let answerRevealed = false;
let timerInterval = null;
let remainingSeconds = 0;
let youtubePlayer = null;
let youtubeReady = false;
let toastTimeout = null;

async function loadQuestions() {
  const response = await fetch("/api/questions");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "無法讀取題庫檔案。");
  if (!Array.isArray(result.questions)) throw new Error("題庫檔案格式錯誤。");
  questions = result.questions;
  refreshAdmin();
}

async function saveQuestions(nextQuestions) {
  const response = await fetch("/api/questions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(nextQuestions),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "無法儲存題庫檔案。");
  questions = nextQuestions;
}

async function saveImage(dataUrl) {
  const image = await fetch(dataUrl);
  const blob = await image.blob();
  const response = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "無法儲存圖片檔案。");
  return result.path;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function updateCounts() {
  elements.questionCount.textContent = questions.length;
  document.querySelectorAll("[data-count]").forEach((item) => {
    const count = questions.filter((question) => question.category === item.dataset.count).length;
    item.textContent = `${count} 道題目`;
  });
  elements.bankTotal.textContent = `${questions.length} 題`;
}

function renderQuestionList() {
  const visible = questions.filter((question) => activeFilter === "all" || question.category === activeFilter);
  if (!visible.length) {
    elements.questionList.innerHTML = '<div class="empty-bank">目前沒有題目，從左側新增第一題吧！</div>';
    return;
  }
  elements.questionList.innerHTML = visible.map((question) => {
    const detail = categoryDetails[question.category];
    const thumb = question.image
      ? `<img src="${escapeHtml(question.image)}" alt="" />`
      : `<span>${detail.icon}</span>`;
    return `<div class="question-row">
      <div class="question-thumb">${thumb}</div>
      <div class="question-info"><strong>${escapeHtml(question.answer)}</strong><span>${detail.title}</span></div>
      <div class="row-actions">
        <button type="button" data-edit="${question.id}" aria-label="編輯 ${escapeHtml(question.answer)}">編輯</button>
        <button class="delete-question" type="button" data-delete="${question.id}" aria-label="刪除 ${escapeHtml(question.answer)}">刪除</button>
      </div>
    </div>`;
  }).join("");
}

function refreshAdmin() {
  updateCounts();
  renderQuestionList();
}

function updateFormFields() {
  const category = elements.category.value;
  elements.youtubeField.classList.toggle("hidden", category !== "music");
  elements.imageField.classList.toggle("hidden", category !== "image");
  elements.silhouetteField.classList.toggle("hidden", category !== "silhouette");
  elements.durationField.classList.toggle("hidden", category !== "music");
  elements.youtubeUrl.required = false;
  elements.questionImage.required = false;
  elements.silhouetteImage.required = false;
}

function resetForm() {
  elements.questionForm.reset();
  elements.category.value = "music";
  editingId = null;
  selectedImage = null;
  selectedSilhouette = null;
  elements.imagePreview.removeAttribute("src");
  elements.silhouettePreview.removeAttribute("src");
  elements.imagePreview.classList.add("hidden");
  elements.silhouettePreview.classList.add("hidden");
  elements.formTitle.textContent = "新增題目";
  elements.saveQuestion.innerHTML = "新增題目 <span>＋</span>";
  elements.cancelEdit.classList.add("hidden");
  elements.formMessage.classList.add("hidden");
  updateFormFields();
}

function showFormMessage(message, type) {
  elements.formMessage.textContent = message;
  elements.formMessage.className = `form-message ${type}`;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function setPreview(input, preview, kind) {
  const file = input.files?.[0];
  if (!file) return Promise.resolve(null);
  if (!file.type.startsWith("image/")) {
    showFormMessage("請選擇有效的圖片檔案。", "error");
    input.value = "";
    return Promise.resolve(null);
  }
  if (file.size > 10 * 1024 * 1024) {
    showFormMessage("圖片檔案需小於 10 MB。", "error");
    input.value = "";
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("無法讀取圖片檔案。"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("無法解析這張圖片。"));
      image.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: kind === "silhouette" });
        if (!context) {
          reject(new Error("瀏覽器無法處理這張圖片。"));
          return;
        }
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let silhouette = null;
        if (kind === "silhouette") {
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const sample = (x, y) => {
            const offset = (y * canvas.width + x) * 4;
            return [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2]];
          };
          const borderColors = [];
          for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 40))) {
            borderColors.push(sample(x, 0), sample(x, canvas.height - 1));
          }
          for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 40))) {
            borderColors.push(sample(0, y), sample(canvas.width - 1, y));
          }
          const background = [0, 1, 2].map((channel) =>
            borderColors.reduce((sum, color) => sum + color[channel], 0) / borderColors.length);
          const visited = new Uint8Array(canvas.width * canvas.height);
          const queue = [];
          const addBackground = (x, y) => {
            const pixelIndex = y * canvas.width + x;
            if (visited[pixelIndex]) return;
            const offset = pixelIndex * 4;
            const distance = Math.hypot(
              pixels.data[offset] - background[0],
              pixels.data[offset + 1] - background[1],
              pixels.data[offset + 2] - background[2],
            );
            if (distance > 72) return;
            visited[pixelIndex] = 1;
            queue.push(pixelIndex);
          };
          for (let x = 0; x < canvas.width; x++) {
            addBackground(x, 0);
            addBackground(x, canvas.height - 1);
          }
          for (let y = 0; y < canvas.height; y++) {
            addBackground(0, y);
            addBackground(canvas.width - 1, y);
          }
          for (let cursor = 0; cursor < queue.length; cursor++) {
            const pixelIndex = queue[cursor];
            const x = pixelIndex % canvas.width;
            const y = Math.floor(pixelIndex / canvas.width);
            if (x > 0) addBackground(x - 1, y);
            if (x + 1 < canvas.width) addBackground(x + 1, y);
            if (y > 0) addBackground(x, y - 1);
            if (y + 1 < canvas.height) addBackground(x, y + 1);
          }
          for (let index = 0; index < pixels.data.length; index += 4) {
            pixels.data[index] = 0;
            pixels.data[index + 1] = 0;
            pixels.data[index + 2] = 0;
            if (visited[index / 4]) pixels.data[index + 3] = 0;
          }
          context.putImageData(pixels, 0, 0);
          silhouette = canvas.toDataURL("image/png");
        }
        const data = canvas.toDataURL("image/jpeg", .82);
        preview.src = data;
        preview.classList.remove("hidden");
        resolve(kind === "silhouette" ? { original: data, silhouette } : data);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function getYouTubeId(url) {
  try {
    const parsed = new URL(url);
    let id = "";
    if (parsed.hostname === "youtu.be" || parsed.hostname.endsWith(".youtu.be")) {
      id = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (parsed.hostname.endsWith("youtube.com") || parsed.hostname === "youtube.com") {
      if (parsed.pathname === "/watch") id = parsed.searchParams.get("v") || "";
      else if (/^\/(embed|shorts|live)\//.test(parsed.pathname)) id = parsed.pathname.split("/")[2] || "";
    }
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function onYouTubeIframeAPIReady() {
  youtubeReady = true;
  createYouTubePlayer();
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function createYouTubePlayer() {
  if (!window.YT?.Player) return;
  youtubeReady = true;
  if (youtubePlayer) return;
  youtubePlayer = new YT.Player("youtube-player", {
    width: "1",
    height: "1",
    videoId: "",
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
    events: {
      onReady: () => { youtubePlayer.ready = true; },
      onError: () => {
        stopTimer();
        elements.audioArt.classList.remove("playing");
        elements.pauseAudio.disabled = true;
        elements.timerLabel.textContent = "影片無法播放";
        showToast("YouTube 影片無法播放，請確認影片未設為私人或禁止嵌入。");
      },
    },
  });
}

function openAdmin() {
  elements.adminPanel.classList.remove("hidden");
  elements.adminToggle.setAttribute("aria-expanded", "true");
  elements.adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeAdmin() {
  elements.adminPanel.classList.add("hidden");
  elements.adminToggle.setAttribute("aria-expanded", "false");
}

function openGame(category) {
  gameCategory = category;
  gameQuestions = questions.filter((question) => question.category === category);
  gameIndex = 0;
  const detail = categoryDetails[category];
  elements.gameTitle.textContent = detail.title;
  elements.gameEyebrow.textContent = detail.eyebrow;
  elements.gameCategoryIcon.textContent = detail.icon;
  elements.gameOverlay.classList.remove("hidden");
  document.body.classList.add("modal-open");
  renderGameQuestion();
}

function clearGameDisplay() {
  stopTimer();
  if (youtubePlayer?.pauseVideo) {
    try { youtubePlayer.pauseVideo(); } catch (error) { console.error("Could not stop YouTube playback.", error); }
  }
  elements.youtubeStage.classList.add("hidden");
  elements.imageStage.classList.add("hidden");
  elements.silhouetteStage.classList.add("hidden");
  elements.emptyRound.classList.add("hidden");
  elements.answerReveal.classList.add("hidden");
  elements.audioControls.classList.add("hidden");
  elements.revealAnswer.classList.add("hidden");
  elements.nextQuestion.classList.add("hidden");
  elements.gameHint.classList.add("hidden");
  elements.audioArt.classList.remove("playing");
  elements.pauseAudio.disabled = true;
}

function renderGameQuestion() {
  clearGameDisplay();
  if (!gameQuestions.length) {
    elements.gameCounter.textContent = "00 / 00";
    elements.emptyRound.classList.remove("hidden");
    return;
  }
  answerRevealed = false;
  const question = gameQuestions[gameIndex];
  elements.gameCounter.textContent = `${String(gameIndex + 1).padStart(2, "0")} / ${String(gameQuestions.length).padStart(2, "0")}`;
  if (gameCategory === "music") {
    elements.youtubeStage.classList.remove("hidden");
    elements.audioControls.classList.remove("hidden");
    elements.timerLabel.textContent = `${question.duration} 秒片段`;
    elements.gameHint.classList.remove("hidden");
    if (!youtubeReady) createYouTubePlayer();
  } else if (gameCategory === "image") {
    elements.imageStage.classList.remove("hidden");
    elements.gameImage.src = question.image;
    elements.revealAnswer.classList.remove("hidden");
    elements.gameHint.classList.remove("hidden");
  } else {
    elements.silhouetteStage.classList.remove("hidden");
    elements.silhouetteStage.classList.remove("revealed");
    elements.gameSilhouette.src = question.silhouette;
    elements.revealAnswer.classList.remove("hidden");
    elements.gameHint.classList.remove("hidden");
  }
}

function startTimer(seconds) {
  stopTimer();
  remainingSeconds = seconds;
  elements.timerLabel.textContent = `播放中 ${remainingSeconds} 秒`;
  document.querySelector(".timer-dot").classList.add("active");
  timerInterval = setInterval(() => {
    remainingSeconds -= 1;
    if (remainingSeconds <= 0) {
      stopTimer();
      if (youtubePlayer?.pauseVideo) youtubePlayer.pauseVideo();
      elements.audioArt.classList.remove("playing");
      elements.pauseAudio.disabled = true;
      elements.timerLabel.textContent = "片段播放完畢，開始搶答！";
      elements.revealAnswer.classList.remove("hidden");
      return;
    }
    elements.timerLabel.textContent = `播放中 ${remainingSeconds} 秒`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  document.querySelector(".timer-dot").classList.remove("active");
}

function revealAnswer() {
  if (!gameQuestions.length) return;
  answerRevealed = true;
  const question = gameQuestions[gameIndex];
  elements.answerText.textContent = question.answer;
  elements.answerReveal.classList.remove("hidden");
  if (gameCategory === "silhouette") elements.silhouetteStage.classList.add("revealed");
  elements.revealAnswer.classList.add("hidden");
  elements.gameHint.classList.add("hidden");
  if (gameIndex < gameQuestions.length - 1) elements.nextQuestion.classList.remove("hidden");
}

elements.adminToggle.addEventListener("click", () => {
  const willOpen = elements.adminPanel.classList.contains("hidden");
  if (willOpen) openAdmin();
  else closeAdmin();
});
elements.closeAdmin.addEventListener("click", closeAdmin);
elements.category.addEventListener("change", updateFormFields);
elements.questionImage.addEventListener("change", async () => {
  try { selectedImage = await setPreview(elements.questionImage, elements.imagePreview, "image"); }
  catch (error) { showFormMessage(error.message, "error"); }
  updateFormFields();
});
elements.silhouetteImage.addEventListener("change", async () => {
  try { selectedSilhouette = await setPreview(elements.silhouetteImage, elements.silhouettePreview, "silhouette"); }
  catch (error) { showFormMessage(error.message, "error"); }
  updateFormFields();
});
[
  elements.questionImage,
  elements.silhouetteImage,
].forEach((input) => {
  const zone = input.labels[0];
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
    const [file] = event.dataTransfer.files;
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

elements.questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const category = elements.category.value;
  const answer = elements.answer.value.trim();
  const existing = editingId ? questions.find((question) => question.id === editingId) : null;
  if (!answer) {
    showFormMessage("請輸入正確答案。", "error");
    return;
  }
  const question = {
    id: editingId || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    category,
    answer,
    duration: Math.min(60, Math.max(1, Number(elements.duration.value) || 8)),
    youtubeUrl: "",
    videoId: "",
    image: "",
    silhouette: "",
  };
  try {
    if (category === "music") {
      const videoId = getYouTubeId(elements.youtubeUrl.value.trim());
      if (!videoId) {
        showFormMessage("請輸入有效的 YouTube 影片網址。", "error");
        return;
      }
      question.youtubeUrl = elements.youtubeUrl.value.trim();
      question.videoId = videoId;
    } else if (category === "image") {
      if (!selectedImage && !existing?.image) {
        showFormMessage("請上傳題目圖片。", "error");
        return;
      }
      question.image = selectedImage ? await saveImage(selectedImage) : existing.image;
    } else {
      if (!selectedSilhouette && !existing?.silhouette) {
        showFormMessage("請上傳角色圖片。", "error");
        return;
      }
      question.silhouette = selectedSilhouette
        ? await saveImage(selectedSilhouette.silhouette)
        : existing.silhouette;
      question.image = selectedSilhouette
        ? await saveImage(selectedSilhouette.original)
        : existing.image;
    }
    const nextQuestions = existing
      ? questions.map((item) => item.id === editingId ? question : item)
      : [...questions, question];
    await saveQuestions(nextQuestions);
    refreshAdmin();
    resetForm();
    showToast(existing ? "題目已更新！" : "題目已新增！");
  } catch (error) {
    console.error("Could not save the question.", error);
    showFormMessage(error.message || "儲存失敗，請確認本機服務正常運作。", "error");
  }
});

elements.cancelEdit.addEventListener("click", resetForm);
document.querySelectorAll(".bank-tab").forEach((tab) => tab.addEventListener("click", () => {
  activeFilter = tab.dataset.filter;
  document.querySelectorAll(".bank-tab").forEach((item) => item.classList.toggle("active", item === tab));
  renderQuestionList();
}));

elements.questionList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const questionId = button.dataset.edit || button.dataset.delete;
  const question = questions.find((item) => item.id === questionId);
  if (!question) return;
  if (button.dataset.delete) {
    const nextQuestions = questions.filter((item) => item.id !== questionId);
    try {
      await saveQuestions(nextQuestions);
    } catch (error) {
      console.error("Could not delete the question.", error);
      showToast(error.message || "刪除失敗，請確認本機服務正常運作。");
      return;
    }
    refreshAdmin();
    if (editingId === questionId) resetForm();
    return;
  }
  resetForm();
  editingId = question.id;
  elements.category.value = question.category;
  elements.answer.value = question.answer;
  elements.duration.value = question.duration || 8;
  elements.youtubeUrl.value = question.youtubeUrl || "";
  selectedImage = null;
  selectedSilhouette = null;
  if (question.category === "image" && question.image) {
    elements.imagePreview.src = question.image;
    elements.imagePreview.classList.remove("hidden");
  }
  if (question.category === "silhouette" && question.image) {
    elements.silhouettePreview.src = question.image;
    elements.silhouettePreview.classList.remove("hidden");
  }
  elements.formTitle.textContent = "編輯題目";
  elements.saveQuestion.innerHTML = "儲存修改 <span>✓</span>";
  elements.cancelEdit.classList.remove("hidden");
  updateFormFields();
  elements.questionForm.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelectorAll(".category-card").forEach((card) => card.addEventListener("click", () => openGame(card.dataset.category)));
elements.closeGame.addEventListener("click", () => {
  clearGameDisplay();
  elements.gameOverlay.classList.add("hidden");
  document.body.classList.remove("modal-open");
});
elements.backToCategories.addEventListener("click", () => {
  elements.closeGame.click();
  document.querySelector(".game-section").scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.emptyAdmin.addEventListener("click", () => {
  elements.closeGame.click();
  openAdmin();
});
elements.gameOverlay.addEventListener("click", (event) => {
  if (event.target === elements.gameOverlay) elements.closeGame.click();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.gameOverlay.classList.contains("hidden")) elements.closeGame.click();
});

elements.playAudio.addEventListener("click", () => {
  const question = gameQuestions[gameIndex];
  if (!question) return;
  if (!youtubeReady || !youtubePlayer?.ready) {
    createYouTubePlayer();
    elements.timerLabel.textContent = "YouTube 載入中，請稍後再試";
    return;
  }
  youtubePlayer.loadVideoById({ videoId: question.videoId, startSeconds: 0, suggestedQuality: "small" });
  youtubePlayer.playVideo();
  elements.audioArt.classList.add("playing");
  elements.pauseAudio.disabled = false;
  startTimer(question.duration);
});
elements.pauseAudio.addEventListener("click", () => {
  stopTimer();
  if (youtubePlayer?.pauseVideo) youtubePlayer.pauseVideo();
  elements.audioArt.classList.remove("playing");
  elements.pauseAudio.disabled = true;
  elements.timerLabel.textContent = "已暫停，開始搶答！";
  document.querySelector(".timer-dot").classList.remove("active");
  elements.revealAnswer.classList.remove("hidden");
});
elements.revealAnswer.addEventListener("click", revealAnswer);
elements.nextQuestion.addEventListener("click", () => {
  if (gameIndex < gameQuestions.length - 1) {
    gameIndex += 1;
    renderGameQuestion();
  }
});

updateFormFields();
loadQuestions().catch((error) => {
  console.error("Could not initialize the question bank.", error);
  showToast(`無法載入本機題庫：${error.message}`);
});

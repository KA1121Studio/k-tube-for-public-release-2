const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "default";
const videoId = params.get("id");

const video = document.getElementById("video");
const audio = document.getElementById("audio");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error-message");
const bufferSpinner = document.getElementById("buffer-spinner");

const bigPlayBtn = document.getElementById("big-play-btn");
const playPauseBtn = document.getElementById("play-pause-btn");
const volumeBtn = document.getElementById("volume-btn");
const volumeSlider = document.getElementById("volume-slider");
const timeDisplay = document.getElementById("time-display");
const progressContainer = document.getElementById("progress-container");
const playedBar = document.getElementById("played-bar");
const loadedBar = document.getElementById("loaded-bar");
const thumb = document.getElementById("thumb");
const controlBar = document.getElementById("control-bar");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const downloadBtn = document.getElementById("download-btn");
const pipBtn = document.getElementById("pip-btn");
const settingsBtn = document.getElementById("settings-btn");
const settingsMenu = document.getElementById("settings-menu");
const playerContainer = document.getElementById("player-container");
const doubleTapIndicator = document.getElementById("double-tap-indicator");
const speedIndicator = document.getElementById("speed-indicator");

if (!videoId) {
  showError("動画IDが指定されていません");
} else {
  loadVideo();
}

// ==================== APIリスト取得 ====================
async function getApiList() {
  try {
    const res = await fetch('/API.json');
    if (!res.ok) throw new Error('API.json の読み込みに失敗');
    return await res.json();
  } catch (err) {
    console.warn('API.json 読み込みエラー:', err);
    return ["https://splendid-jelly-e731bd.netlify.app/.netlify/functions"];
  }
}

// ==================== 最速APIレース ====================
async function fetchFastestApi(videoId) {
  const apiList = await getApiList();
  if (!Array.isArray(apiList) || apiList.length === 0) {
    throw new Error('APIリストが空です');
  }
  const requests = apiList.map(baseUrl => {
    const url = `${baseUrl}/video?v=${videoId}`;
    return fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => ({ data, source: baseUrl }));
  });
  try {
    const fastest = await Promise.any(requests);
    console.log(`最速API成功: ${fastest.source}`);
    return fastest.data;
  } catch (err) {
    console.error('全てのAPIが失敗しました', err);
    throw new Error('動画情報の取得に失敗しました（全API失敗）');
  }
}

// ==================== メインの動画読み込み ====================
async function loadVideo() {
  try {
    let streamData;

    if (mode === "api1-high" || mode === "api1-prog") {
      const data = await fetchFastestApi(videoId);
      if (mode === "api1-high") {
        const videoFormat = data.adaptiveFormats?.find(f =>
          f.type?.includes("video/mp4") && (f.qualityLabel?.includes("720") || f.qualityLabel?.includes("1080"))
        ) || data.adaptiveFormats?.find(f => f.type?.includes("video/mp4"));
        const audioFormat = data.adaptiveFormats?.find(f =>
          f.type?.includes("audio/mp4") || f.type?.includes("audio")
        );
        if (!videoFormat?.url) throw new Error("高画質ビデオストリームが見つかりません");
        if (!audioFormat?.url) throw new Error("音声ストリームが見つかりません");
        video.src = videoFormat.url;
        audio.src = audioFormat.url;
        syncVideoAudio();
      } else { // api1-prog
        const prog = data.formatStreams?.find(f =>
          f.type?.includes("video/mp4") && (f.qualityLabel?.includes("360") || f.itag === 18)
        ) || data.formatStreams?.[0];
        if (!prog?.url) throw new Error("音声込みストリームが見つかりません");
        video.src = prog.url;
        if (audio) audio.remove();
      }
    } else {
      // yt-dlp モード
      const apiEndpoint = mode === "360" ? "/video360" : "/video";
      const res = await fetch(`${apiEndpoint}?id=${videoId}`);
      if (!res.ok) throw new Error(`yt-dlp APIエラー: ${res.status}`);
      streamData = await res.json();
      if (!streamData.video) throw new Error("動画URLが取得できません");
      video.src = `/proxy?url=${encodeURIComponent(streamData.video)}`;

      if (mode === "360") {
        if (audio) audio.remove();
        try {
          localStorage.setItem("last360VideoUrl", streamData.video);
          if (window.parent) window.parent.postMessage("video360-ready", "*");
        } catch (e) {
          console.warn("localStorage保存失敗", e);
        }
      } else {
        if (!streamData.audio) throw new Error("音声URLが取得できません");
        audio.src = `/proxy?url=${encodeURIComponent(streamData.audio)}`;
        syncVideoAudio();
      }
    }

    loadingEl.style.display = "none";
    setupControls();
  } catch (err) {
    console.error("動画読み込みエラー:", err);
    showError(`動画の読み込みに失敗しました<br>${err.message}<br><br>別の再生方法を試してください。`);
  }
}

// ==================== 音声同期 ====================
function syncVideoAudio() {
  video.addEventListener("play", () => audio.play().catch(() => {}));
  video.addEventListener("pause", () => audio.pause());
  video.addEventListener("seeking", () => { audio.currentTime = video.currentTime; });
  video.addEventListener("ratechange", () => { audio.playbackRate = video.playbackRate; });
  video.addEventListener("volumechange", () => {
    audio.volume = video.volume;
    audio.muted = video.muted;
  });
}

function showError(message) {
  loadingEl.style.display = "none";
  bufferSpinner.style.display = "none";
  errorEl.innerHTML = message;
  errorEl.style.display = "block";
}

// ==================== クリーンモード管理 ====================
let cleanModeTimer = null;
const CLEAN_DELAY = 3000;

function enterCleanMode() {
  if (playerContainer.classList.contains('clean-mode')) return;
  playerContainer.classList.add('clean-mode');
  playerContainer.classList.remove('show-controls');
  clearTimeout(cleanModeTimer);
}

function exitCleanMode() {
  playerContainer.classList.remove('clean-mode');
}

function resetActivity() {
  exitCleanMode();
  playerContainer.classList.add('show-controls');
  clearTimeout(cleanModeTimer);
  if (!video.paused) {
    cleanModeTimer = setTimeout(enterCleanMode, CLEAN_DELAY);
  }
}

// ==================== カスタムコントロール全機能 ====================
function setupControls() {
  // アクティビティ検知
  const events = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'wheel'];
  events.forEach(evt => {
    document.addEventListener(evt, (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      resetActivity();
    });
  });
  video.addEventListener('play', resetActivity);
  video.addEventListener('pause', () => {
    exitCleanMode();
    playerContainer.classList.add('show-controls');
    clearTimeout(cleanModeTimer);
  });

  // 再生/一時停止ボタン
  function updatePlayPauseIcon() {
    const icon = playPauseBtn.querySelector('.material-icons');
    if (video.paused) {
      icon.textContent = 'play_arrow';
      bigPlayBtn.style.display = 'flex';
      playerContainer.classList.add('show-controls');
      clearTimeout(cleanModeTimer);
    } else {
      icon.textContent = 'pause';
      bigPlayBtn.style.display = 'none';
    }
  }

  playPauseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    video.paused ? video.play() : video.pause();
  });
  bigPlayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    video.play();
  });
  video.addEventListener('play', updatePlayPauseIcon);
  video.addEventListener('pause', updatePlayPauseIcon);
  video.addEventListener('ended', updatePlayPauseIcon);
  updatePlayPauseIcon();

  // 時間表示・シークバー
  function formatTime(sec) {
    if (isNaN(sec)) return "0:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
  }

  video.addEventListener('timeupdate', () => {
    const current = video.currentTime;
    const duration = video.duration || 0;
    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    if (duration > 0) {
      const percent = (current / duration) * 100;
      playedBar.style.width = `${percent}%`;
      thumb.style.left = `${percent}%`;
    }
    if (video.buffered.length > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const loadedPercent = (bufferedEnd / duration) * 100;
      loadedBar.style.width = `${loadedPercent}%`;
    }
  });

  video.addEventListener('waiting', () => {
    if (!video.paused) bufferSpinner.style.display = 'block';
  });
  video.addEventListener('canplay', () => bufferSpinner.style.display = 'none');
  video.addEventListener('playing', () => bufferSpinner.style.display = 'none');

  // シークバー操作
  let isSeeking = false;
  function seekTo(e) {
    const rect = progressContainer.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const posX = clientX - rect.left;
    const ratio = Math.min(Math.max(posX / rect.width, 0), 1);
    video.currentTime = ratio * video.duration;
  }
  progressContainer.addEventListener('mousedown', (e) => {
    isSeeking = true;
    seekTo(e);
    video.pause();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', (e) => { if (isSeeking) seekTo(e); });
  document.addEventListener('mouseup', () => {
    if (isSeeking) {
      isSeeking = false;
      video.play().catch(() => {});
    }
  });
  progressContainer.addEventListener('touchstart', (e) => {
    isSeeking = true;
    seekTo(e);
    video.pause();
    e.stopPropagation();
  });
  document.addEventListener('touchmove', (e) => { if (isSeeking) seekTo(e); });
  document.addEventListener('touchend', () => {
    if (isSeeking) {
      isSeeking = false;
      video.play().catch(() => {});
    }
  });

  // 音量
  function updateVolumeIcon() {
    const icon = volumeBtn.querySelector('.material-icons');
    if (video.muted || video.volume === 0) icon.textContent = 'volume_off';
    else if (video.volume < 0.5) icon.textContent = 'volume_down';
    else icon.textContent = 'volume_up';
  }
  volumeSlider.addEventListener('input', () => {
    video.volume = volumeSlider.value;
    video.muted = (video.volume === 0);
    updateVolumeIcon();
  });
  volumeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    updateVolumeIcon();
  });
  video.addEventListener('volumechange', () => {
    volumeSlider.value = video.muted ? 0 : video.volume;
    updateVolumeIcon();
  });
  updateVolumeIcon();

  // フルスクリーン
  function updateFullscreenIcon() {
    fullscreenBtn.querySelector('.material-icons').textContent =
      document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen';
  }
  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
    else playerContainer.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  updateFullscreenIcon();

  // ダウンロード（新しいタブで開く）
  downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = video.src || video.currentSrc;
    if (url) window.open(url, '_blank');
  });

  // PiP
  if ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) {
    pipBtn.style.display = 'flex';
    pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) await document.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch (err) { console.warn('PiPエラー:', err); }
    });
    video.addEventListener('enterpictureinpicture', () => pipBtn.querySelector('.material-icons').textContent = 'picture_in_picture');
    video.addEventListener('leavepictureinpicture', () => pipBtn.querySelector('.material-icons').textContent = 'picture_in_picture_alt');
  } else {
    pipBtn.style.display = 'none';
  }

  // 設定メニュー
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.style.display = settingsMenu.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!settingsMenu.contains(e.target) && e.target !== settingsBtn) settingsMenu.style.display = 'none';
  });
  let originalRate = 1.0;
  settingsMenu.querySelectorAll('.settings-item').forEach(item => {
    item.addEventListener('click', () => {
      const speed = parseFloat(item.dataset.speed);
      video.playbackRate = speed;
      originalRate = speed;
      settingsMenu.querySelectorAll('.settings-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      settingsMenu.style.display = 'none';
    });
  });
  video.playbackRate = 1.0;

  // キーボードショートカット
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    switch (e.key) {
      case ' ': e.preventDefault(); video.paused ? video.play() : video.pause(); break;
      case 'ArrowLeft': e.preventDefault(); video.currentTime -= 5; break;
      case 'ArrowRight': e.preventDefault(); video.currentTime += 5; break;
      case 'ArrowUp': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); break;
      case 'ArrowDown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); break;
      case 'f': case 'F': e.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else playerContainer.requestFullscreen();
        break;
      case 'm': case 'M': e.preventDefault(); video.muted = !video.muted; break;
      case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
        e.preventDefault(); video.currentTime = (parseInt(e.key) * 10 / 100) * video.duration; break;
      case 'Home': e.preventDefault(); video.currentTime = 0; break;
      case 'End': e.preventDefault(); video.currentTime = video.duration; break;
    }
  });

  // ダブルクリック対策（クリック遅延キャンセル）
  let clickTimer = null;
  video.addEventListener('click', (e) => {
    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const marginX = rect.width * 0.2;
    const marginY = rect.height * 0.2;

    // 中央領域クリックのみ再生/停止を予約（ダブルクリックならキャンセル）
    if (x > marginX && x < rect.width - marginX && y > marginY && y < rect.height - marginY) {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        // ダブルクリックが発生したので再生/停止は行わない（ダブルクリックイベント側に任せる）
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        video.paused ? video.play() : video.pause();
      }, 300);
    } else {
      // 端クリック：クリーンモード手動切替
      if (playerContainer.classList.contains('clean-mode')) {
        exitCleanMode();
        resetActivity();
      } else {
        enterCleanMode();
      }
    }
  });

  // ダブルクリックで±10秒
  video.addEventListener('dblclick', (e) => {
    // 保留中のシングルクリックをキャンセル
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    const rect = video.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      video.currentTime -= 10;
      showDoubleTapIndicator('fast_rewind', '10秒戻る');
    } else {
      video.currentTime += 10;
      showDoubleTapIndicator('fast_forward', '10秒進む');
    }
  });

  // 長押し2倍速再生
  let longPressTimer = null;
  let longPressTriggered = false;

  function startLongPress(e) {
    e.preventDefault();
    longPressTriggered = false;
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      originalRate = video.playbackRate;
      video.playbackRate = 2.0;
      speedIndicator.classList.add('show');
    }, 500);
  }
  function endLongPress() {
    clearTimeout(longPressTimer);
    if (longPressTriggered) {
      video.playbackRate = originalRate;
      longPressTriggered = false;
      speedIndicator.classList.remove('show');
    }
  }
  video.addEventListener('mousedown', startLongPress);
  video.addEventListener('mouseup', endLongPress);
  video.addEventListener('mouseleave', endLongPress);
  video.addEventListener('touchstart', startLongPress, {passive: false});
  video.addEventListener('touchend', endLongPress);
  video.addEventListener('touchcancel', endLongPress);

  // マウスホイールで音量調整
  video.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    video.volume = Math.min(1, Math.max(0, video.volume + delta));
  }, { passive: false });

  // 初期状態
  resetActivity();
}

function showDoubleTapIndicator(iconName, text) {
  doubleTapIndicator.querySelector('.material-icons').textContent = iconName;
  doubleTapIndicator.querySelector('.tap-text').textContent = text;
  doubleTapIndicator.classList.add('show');
  clearTimeout(doubleTapIndicator._timeout);
  doubleTapIndicator._timeout = setTimeout(() => {
    doubleTapIndicator.classList.remove('show');
  }, 700);
}

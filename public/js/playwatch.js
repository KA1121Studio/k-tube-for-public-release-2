// js/watch.js

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "default";
const videoId = params.get("id");

const videoEl = document.getElementById("video");
const audioEl = document.getElementById("audio");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error-message");

if (!videoId) {
  showError("動画IDが指定されていません");
} else {
  loadVideo();
}

// ==================== 新しい関数：API.jsonからAPIリストを取得 ====================
async function getApiList() {
  try {
    const res = await fetch('/API.json');
    if (!res.ok) throw new Error('API.json の読み込みに失敗');
    return await res.json();   // 配列 ["https://...", "https://...", ...] が返る
  } catch (err) {
    console.warn('API.json 読み込みエラー:', err);
    return ["https://splendid-jelly-e731bd.netlify.app/.netlify/functions"]; // フォールバック
  }
}

// ==================== 最速APIで動画情報を取得（レース） ====================
async function fetchFastestApi(videoId) {
  const apiList = await getApiList();
  
  if (!Array.isArray(apiList) || apiList.length === 0) {
    throw new Error('APIリストが空です');
  }

  // 全てのAPIに同時にリクエストを送り、一番早く成功したものを返す
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

// ==================== メインの動画読み込み関数 ====================
async function loadVideo() {
  try {
    let streamData;

    // ── 1. 新API（API.jsonから動的に取得）を使うモード ──
    if (mode === "api1-high" || mode === "api1-prog") {
      const data = await fetchFastestApi(videoId);

      if (mode === "api1-high") {
        // 高画質：adaptive video + audio を分離
        const videoFormat = data.adaptiveFormats?.find(f =>
          f.type?.includes("video/mp4") && (f.qualityLabel?.includes("720") || f.qualityLabel?.includes("1080"))
        ) || data.adaptiveFormats?.find(f => f.type?.includes("video/mp4"));

        const audioFormat = data.adaptiveFormats?.find(f =>
          f.type?.includes("audio/mp4") || f.type?.includes("audio")
        );

        if (!videoFormat?.url) throw new Error("高画質ビデオストリームが見つかりません");
        if (!audioFormat?.url) throw new Error("音声ストリームが見つかりません");

        videoEl.src = videoFormat.url;
        audioEl.src = audioFormat.url;
        syncVideoAudio();
      } else {
        // api1-prog：音声込み（progressive）
        const prog = data.formatStreams?.find(f =>
          f.type?.includes("video/mp4") && (f.qualityLabel?.includes("360") || f.itag === 18)
        ) || data.formatStreams?.[0];

        if (!prog?.url) throw new Error("音声込みストリームが見つかりません");
        videoEl.src = prog.url;
        if (audioEl) audioEl.remove();
      }
    }
    // ── 2. yt-dlp モード（従来通り） ──
    else {
      const apiEndpoint = mode === "360" ? "/video360" : "/video";
      const res = await fetch(`${apiEndpoint}?id=${videoId}`);
      if (!res.ok) throw new Error(`yt-dlp APIエラー: ${res.status}`);
      streamData = await res.json();

      if (!streamData.video) throw new Error("動画URLが取得できません");

      videoEl.src = `/proxy?url=${encodeURIComponent(streamData.video)}`;

      if (mode === "360") {
        if (audioEl) audioEl.remove();
        try {
          localStorage.setItem("last360VideoUrl", streamData.video);
          if (window.parent) window.parent.postMessage("video360-ready", "*");
        } catch (e) {
          console.warn("localStorage保存失敗", e);
        }
      } else {
        if (!streamData.audio) throw new Error("音声URLが取得できません");
        audioEl.src = `/proxy?url=${encodeURIComponent(streamData.audio)}`;
        syncVideoAudio();
      }
    }

    loadingEl.style.display = "none";
  } catch (err) {
    console.error("動画読み込みエラー:", err);
    showError(`動画の読み込みに失敗しました<br>${err.message}<br><br>別の再生方法を試してください。`);
  }
}

// 同期関数（変更なし）
function syncVideoAudio() {
  videoEl.addEventListener("play", () => audioEl.play().catch(() => {}));
  videoEl.addEventListener("pause", () => audioEl.pause());
  videoEl.addEventListener("seeking", () => { audioEl.currentTime = videoEl.currentTime; });
  videoEl.addEventListener("ratechange", () => { audioEl.playbackRate = videoEl.playbackRate; });
  videoEl.addEventListener("volumechange", () => {
    audioEl.volume = videoEl.volume;
    audioEl.muted = videoEl.muted;
  });
}

function showError(message) {
  loadingEl.style.display = "none";
  errorEl.innerHTML = message;
  errorEl.style.display = "block";
}

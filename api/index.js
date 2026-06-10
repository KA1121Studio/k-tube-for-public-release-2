import express from "express";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import path from "path";
import { execSync } from "child_process";   
import jwt from 'jsonwebtoken';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);



const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import crypto from 'crypto';

/**
 * パスワードをハッシュ化（salt付き）
 * @param {string} password 平文
 * @returns {string} salt:hash の形式
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * ハッシュ化されたパスワードを検証
 * @param {string} password 平文
 * @param {string} stored   salt:hash の形式
 * @returns {boolean}
 */
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// サーバー起動時（listen の直前など）
async function ensureDefaultAdmin() {
  if (!process.env.ADMIN_ID || !process.env.ADMIN_PASSWORD) return;  // ここを修正

  const { data: existing } = await supabase
    .from('admins')
    .select('id')
    .eq('username', process.env.ADMIN_ID)
    .maybeSingle();

  if (existing) return;

  const hashed = hashPassword(process.env.ADMIN_PASSWORD);  // ここも修正
  await supabase.from('admins').insert({
    username: process.env.ADMIN_ID,
    password: hashed,
    is_active: true
  });
  console.log('Default admin created from environment variables.');
}

// ====================== グローバル変数 ======================
let totalAccesses = 0;
let todayAccesses = 0;
let todayDate = new Date().toISOString().split('T')[0];
let activeUsers = new Map();
const ONLINE_TIMEOUT = 5 * 60 * 1000;

// yt-dlp キャッシュ
const videoCache = new Map();
const CACHE_TIME = 1000 * 60 * 60 * 3; // 3時間

// ====================== ルート ======================
app.get("/", async (req, res) => {
  totalAccesses++;
  todayAccesses++;
  updateTodayCount();
  await incrementAccesses(); // ← await 必須
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/watch.html", async (req, res) => {
  totalAccesses++;
  todayAccesses++;
  updateTodayCount();
  await incrementAccesses();
  res.sendFile(path.join(__dirname, "watch.html"));
});

// 今日の日付が変わったらリセット
function updateTodayCount() {
  const currentDate = new Date().toISOString().split('T')[0];
  if (currentDate !== todayDate) {
    todayAccesses = 0;
    todayDate = currentDate;
  }
}

async function incrementAccesses() {
  // JSTで日付(YYYY-MM-DD)を作る
  const today = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '-'); // "YYYY-MM-DD" に寄せる

  // 念のためフォーマットがズレてないか（"YYYY-MM-DD" になるはず）
  // console.log({ today });

  // 今日行があるか
  const { data: todayRows, error: selectError } = await supabase
    .from('access_stats')
    .select('*')
    .eq('date', today);

  if (selectError) {
    console.error("Select error:", selectError);
    return;
  }

  // 今日行があるなら +1（累計も+1）
  if (todayRows && todayRows.length > 0) {
    const row = todayRows[0];

    const { error: updateError } = await supabase
      .from('access_stats')
      .update({
        total_views: row.total_views + 1,
        today_views: row.today_views + 1,
      })
      .eq('id', row.id);

    if (updateError) console.error("Update error:", updateError);
    return;
  }

  // 今日行が無いなら、直前日の total_views を取って +1
  const { data: prevRows, error: prevError } = await supabase
    .from('access_stats')
    .select('total_views')
    .lt('date', today)
    .order('date', { ascending: false })
    .limit(1);

  if (prevError) {
    console.error("Prev select error:", prevError);
    return;
  }

  const prevTotal = prevRows && prevRows.length > 0 ? prevRows[0].total_views : 0;

  const { error: insertError } = await supabase
    .from('access_stats')
    .insert({
      date: today,
      total_views: prevTotal + 1, // 全期間累計を維持
      today_views: 1,
    });

  if (insertError) console.error("Insert error:", insertError);
}


app.get('/api/v2/video', async (req, res) => {
  const videoId = req.query.v;
  if (!videoId) return res.status(400).json({ error: "video id required" });

  const invidiousInstances = [
    "https://nyc1.iv.ggtyler.dev",
    "https://invid-api.poketube.fun",
    "https://cal1.iv.ggtyler.dev",
    "https://invidious.nikkosphere.com",
    "https://lekker.gay",
    "https://invidious.f5.si",
    "https://invidious.lunivers.trade"
    
  ];

  for (const base of invidiousInstances) {
    try {
      const url = `${base}/api/v1/videos/${videoId}`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; K-tube/1.0)' }
      });

      if (!response.ok) continue;

      const data = await response.json();

      // 必要なフィールドだけ整形して返す（フロントと合わせる）
      const result = {
        title: data.title || "不明",
        description: data.description || "",
        viewCount: data.viewCount || 0,
        likeCount: data.likeCount || 0,
        published: data.published 
          ? new Date(data.published * 1000).toISOString() 
          : null,
        uploader: data.author || "不明",
        uploaderUrl: `/channel/${data.authorId || ""}`,
        uploaderAvatar: data.authorThumbnails?.[data.authorThumbnails.length-1]?.url || "",
        thumbnail: data.videoThumbnails?.find(t => t.quality === "maxres")?.url 
                 || data.videoThumbnails?.[0]?.url || "",
        lengthSeconds: data.lengthSeconds || 0,
        // 再生用ストリーム（高画質adaptive + 音声込みprogressive）
        adaptiveFormats: data.adaptiveFormats || [],
        formatStreams: data.formatStreams || [],     // ← ここに360pなどが入る
        relatedStreams: data.recommendedVideos || [] // 関連動画も取れる
      };

      return res.json(result);
    } catch (err) {
      console.warn(`Invidious ${base} failed:`, err.message);
      // 次を試す
    }
  }

  res.status(503).json({ error: "All Invidious instances failed" });
});

// プロキシ（動画チャンク配信用）
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  const lastAccess = activeUsers.get(ip) || 0;
  if (now - lastAccess > ONLINE_TIMEOUT) {
    activeUsers.set(ip, now);
  }

  const currentDate = new Date().toISOString().split('T')[0];
  if (currentDate !== todayDate) {
    todayAccesses = 0;
    todayDate = currentDate;
  }

  
  totalAccesses++;
todayAccesses++;
await incrementAccesses();

  const range = req.headers.range || "bytes=0-";

  try {
    const response = await fetch(url, {
      headers: { Range: range }
    });

    const headers = {
      "Content-Type": response.headers.get("content-type") || "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Range": response.headers.get("content-range") || range,
      "Content-Length": response.headers.get("content-length")
    };

    res.writeHead(response.status, headers);
    response.body.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy failed");
  }
});

// サムネイルプロキシ
app.get("/thumb-proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    console.log("No thumbnail URL");
    return res.status(400).send("URL required");
  }

  console.log(`Proxying thumbnail: ${url}`);

  const allowedHosts = ['yt3.ggpht.com', 'ggpht.com', 'googleusercontent.com', 'pipedproxy', 'private.coffee', 'kavin.rocks'];
  try {
    const urlObj = new URL(url);
    if (!allowedHosts.some(h => urlObj.hostname.includes(h))) {
      console.log(`Blocked invalid host: ${urlObj.hostname}`);
      return res.status(403).send("Invalid host");
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
        "Accept": "image/webp,*/*;q=0.8"
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      const err = await response.text().catch(() => '');
      console.error(`Fetch failed ${response.status}: ${err}`);
      return res.status(response.status).send("Fetch error");
    }

    const buffer = await response.arrayBuffer();

    const headers = {
      "Content-Type": response.headers.get("content-type") || "image/webp",
      "Content-Length": buffer.byteLength,
      "Cache-Control": "public, max-age=604800",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET",
      "Vary": "Origin"
    };

    res.writeHead(200, headers);
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Proxy failed");
  }
});

// HLS用プロキシ
app.get("/proxy-hls", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("URL required");

  try {
    const r = await fetch(url);
    let text = await r.text();

    text = text.replace(
      /(https?:\/\/[^\s]+)/g,
      (m) => m.includes("googlevideo.com") ? `/proxy?url=${encodeURIComponent(m)}` : m
    );

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(text);
  } catch (err) {
    res.status(500).send("HLS proxy failed");
  }
});

// Piped API プロキシ
const pipedInstances = [
  'https://api.piped.private.coffee',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.syncpundit.io',
  'https://api-piped.mha.fi',
  'https://piped-api.garudalinux.org',
  'https://pipedapi.rivo.lol',
  'https://pipedapi.leptons.xyz',
  'https://piped-api.lunar.icu',
  'https://ytapi.dc09.ru',
  'https://pipedapi.colinslegacy.com',
  'https://yapi.vyper.me',
  'https://api.looleh.xyz',
  'https://piped-api.cfe.re',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi-libre.kavin.rocks',
  'https://pa.mint.lgbt',
  'https://pa.il.ax',
  'https://piped-api.privacy.com.de',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.us.projectsegfau.lt',
  'https://api.piped.privacydev.net',
  'https://pipedapi.palveluntarjoaja.eu',
  'https://pipedapi.smnz.de',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.qdi.fi',
  'https://piped-api.hostux.net',
  'https://pdapi.vern.cc',
  'https://pipedapi.pfcd.me',
  'https://pipedapi.frontendfriendly.xyz',
  'https://api.piped.yt',
  'https://pipedapi.astartes.nl',
  'https://pipedapi.osphost.fi',
  'https://pipedapi.simpleprivacy.fr',
  'https://pipedapi.drgns.space',
  'https://piapi.ggtyler.dev',
  'https://api.watch.pluto.lat',
  'https://piped-backend.seitan-ayoub.lol',
  'https://pipedapi.owo.si',
  'https://api.piped.minionflo.net',
  'https://pipedapi.nezumi.party',
  'https://pipedapi.ducks.party',
  'https://pipedapi.ngn.tf',
  'https://pipedapi.coldforge.xyz',
  'https://piped-api.codespace.cz',
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.phoenixthrush.com',
  'https://schaunapi.ehwurscht.at',
  'https://pipedapi.darkness.services',
  'https://pipedapi.andreafortuna.org',
  'https://nyc1.iv.ggtyler.dev',
  'https://invid-api.poketube.fun'
];

app.get('/piped/*', async (req, res) => {
  const path = req.path.replace('/piped', '');
  const query = new URLSearchParams(req.query).toString();

  const requests = pipedInstances.map(async (base) => {
    const targetUrl = `${base}${path}${query ? '?' + query : ''}`;

    const response = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const contentType =
      response.headers.get('content-type') || '';

    // JSON以外を拒否
    if (
      !response.ok ||
      !contentType.includes('application/json')
    ) {
      throw new Error(
        `${base} returned invalid content`
      );
    }

    return response;
  });

  try {
    const response = await Promise.any(requests);

    const contentType = response.headers.get('content-type');

    res.setHeader(
      'Content-Type',
      contentType || 'application/json'
    );

    return response.body.pipe(res);

  } catch (err) {
    console.error(err);

    res.status(503).json({
      error: 'All Piped instances failed'
    });
  }
});

app.get("/download", async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send("URL required");
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      console.error("Download fetch failed:", response.status);
      return res.status(response.status).send("Download fetch failed");
    }

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="video_360p.mp4"'
    );

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "video/mp4"
    );

    response.body.pipe(res);

  } catch (err) {
    console.error("Download proxy error:", err);
    res.status(500).send("Download failed");
  }
});

// 統計取得API
app.get("/stats", async (req, res) => {
  // JSTでYYYY-MM-DDを作る
  const today = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  )
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("access_stats")
    .select("*")
    .eq("date", today)
    .single();

  if (error || !data) {
    return res.json({
      total_views: 0,
      today_views: 0,
      online_now: 0
    });
  }

  const now = Date.now();
  let onlineCount = 0;

  for (const [ip, timestamp] of activeUsers.entries()) {
    if (now - timestamp <= ONLINE_TIMEOUT) {
      onlineCount++;
    } else {
      activeUsers.delete(ip);
    }
  }

  res.json({
    total_views: data.total_views,
    today_views: data.today_views,
    online_now: onlineCount
  });
});

app.get("/fake-views", async (req, res) => {
  try {
    const times = parseInt(req.query.times) || 1;

    for (let i = 0; i < times; i++) {
      await incrementAccesses();   // ← これ追加
    }

    res.json({
      success: true,
      added: times
    });

  } catch (err) {
    console.error("fake-views error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.use("/Tools/Science", express.static("Tools/Science"));

app.all("/Tools/Science/proxy/*", async (req, res) => {
  try {
    const raw = req.params[0]
    const targetUrl = decodeURIComponent(raw)
    const urlObj = new URL(targetUrl)

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "user-agent": req.headers["user-agent"] || "",
        "cookie": req.headers["cookie"] || "",
        "content-type": req.headers["content-type"] || "",
        "authorization": req.headers["authorization"] || "",
        "accept": req.headers["accept"] || "",
        "accept-language": req.headers["accept-language"] || "",
        "referer": urlObj.origin
      },
      body: ["GET", "HEAD"].includes(req.method)
        ? undefined
        : JSON.stringify(req.body),
      redirect: "manual"
    })

    //  リダイレクト対応
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (location) {
        const absolute = new URL(location, targetUrl).href
        return res.redirect("/Tools/Science/proxy/" + encodeURIComponent(absolute))
      }
    }

    const contentType = response.headers.get("content-type") || ""

    //  cookie返却
    const setCookie = response.headers.raw()["set-cookie"]
    if (setCookie) {
      res.setHeader("set-cookie", setCookie)
    }

    //  バイナリ対応
    const isText =
      contentType.includes("text") ||
      contentType.includes("javascript") ||
      contentType.includes("json")

    if (!isText) {
      const buffer = await response.arrayBuffer()
      res.setHeader("content-type", contentType)
      return res.send(Buffer.from(buffer))
    }

    let body = await response.text()

    // =========================
    // HTML処理
    // =========================
    if (contentType.includes("text/html")) {
      const base = `/Tools/Science/proxy/${encodeURIComponent(targetUrl)}`
      body = body.replace("<head>", `<head><base href="${base}">`)

      const inject = `
<script>
(function(){
const proxy = (url) => "/Tools/Science/proxy/" + encodeURIComponent(url);

// =================
// fetch
// =================
const originalFetch = window.fetch;
window.fetch = function(input, init){
  try{
    let url = typeof input === "object" ? input.url : input;
    const absolute = new URL(url, location.href).href;
    const proxied = proxy(absolute);

    if(typeof input === "object"){
      input = new Request(proxied, input);
    } else {
      input = proxied;
    }
  }catch(e){}
  return originalFetch(input, init);
};

// =================
// XHR
// =================
const open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url){
  try{
    const absolute = new URL(url, location.href).href;
    url = proxy(absolute);
  }catch(e){}
  return open.call(this, method, url);
};

// =================
// location制御
// =================
const assign = window.location.assign;
window.location.assign = function(url){
  try{
    const absolute = new URL(url, location.href).href;
    url = proxy(absolute);
  }catch(e){}
  return assign.call(this, url);
};

const replace = window.location.replace;
window.location.replace = function(url){
  try{
    const absolute = new URL(url, location.href).href;
    url = proxy(absolute);
  }catch(e){}
  return replace.call(this, url);
};

// =================
// aタグ強制
// =================
document.addEventListener("click", function(e){
  const a = e.target.closest("a");
  if(!a) return;

  const href = a.getAttribute("href");
  if(!href || href.startsWith("javascript:")) return;

  try{
    const absolute = new URL(href, location.href).href;
    a.href = proxy(absolute);
  }catch(e){}
});

// =================
// form強制
// =================
document.addEventListener("submit", function(e){
  const form = e.target;
  if(!form.action) return;

  try{
    const absolute = new URL(form.action, location.href).href;
    form.action = proxy(absolute);
  }catch(e){}
});

// =================
// WebSocket
// =================
const WS = window.WebSocket;
window.WebSocket = function(url, protocols){
  try{
    const absolute = new URL(url, location.href).href;
    url = proxy(absolute);
  }catch(e){}
  return new WS(url, protocols);
};

})();
</script>
`

      body = body.replace("</head>", inject + "</head>")

      //  リンク書き換え
      body = body.replace(/(src|href)=["'](.*?)["']/gi, (m, attr, link) => {
        try {
          if (link.startsWith("data:") || link.startsWith("javascript:")) return m
          const absolute = new URL(link, targetUrl).href
          return attr + '="/Tools/Science/proxy/' + encodeURIComponent(absolute) + '"'
        } catch {
          return m
        }
      })

      // iframe制限
      body = body.replace(/<iframe/gi, '<iframe sandbox="allow-scripts allow-forms"')
    }

    // CSP解除＆再設定
    res.removeHeader("content-security-policy")
    res.removeHeader("x-frame-options")

    res.setHeader(
      "content-security-policy",
      "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'"
    )

    res.setHeader("content-type", contentType)
    res.send(body)

  } catch (e) {
    console.error(e)
    res.status(500).send("proxy error")
  }
})



// デバイスIDを生成・検証するヘルパー（フロントで固定IDを使う場合は不要だが、安全のため）
function getDeviceIdFromHeader(req) {
  let deviceId = req.headers['x-device-id'];
  if (!deviceId || deviceId.length < 10) {
    deviceId = crypto.randomBytes(16).toString('hex');
  }
  return deviceId;
}

app.get('/api/notifications', async (req, res) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing device-id' });
  }

  const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }).split('T')[0];
  // ISO 形式 YYYY-MM-DD に変換（日本時間）
  const jstDate = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g, '-');

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'DB error' });
  }

  // 既に表示済みの ID を取得
  const { data: dismissed } = await supabase
    .from('notification_dismissals')
    .select('notification_id')
    .eq('device_id', deviceId)
    .eq('dismissed_date', jstDate);

  const dismissedIds = new Set(dismissed?.map(d => d.notification_id) || []);

  const activeNotifications = data.filter(n => !dismissedIds.has(n.id));

  res.json(activeNotifications);
});

app.post('/api/notifications/dismiss', async (req, res) => {
  const { notificationId } = req.body;
  const deviceId = req.headers['x-device-id'];
  if (!deviceId || !notificationId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const jstDate = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' }).replace(/\//g, '-');

  const { error } = await supabase
    .from('notification_dismissals')
    .insert({
      notification_id: notificationId,
      device_id: deviceId,
      dismissed_date: jstDate
    });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'Insert failed' });
  }
  res.json({ success: true });
});



app.get('/api/maintenance', async (req, res) => {
  const now = new Date();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('type', 'maintenance')
    .eq('is_active', true)
    .lte('scheduled_start', now.toISOString())
    .gte('scheduled_end', now.toISOString())
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'DB error' });
  }
  if (data) {
    return res.json({
      active: true,
      action: data.maintenance_action, // 0 or 1
      title: data.title,
      content: data.content,
      start: data.scheduled_start,
      end: data.scheduled_end
    });
  }
  res.json({ active: false });
});

// 管理画面用の簡易認証 (session を使わず、/admin-login でトークンを返す)

const ADMIN_ID = process.env.ADMIN_ID;
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');


// 認証ミドルウェア
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.admin) {
      return next(); // 認証成功
    }
    throw new Error('Invalid token payload');
  } catch (err) {
    console.error('[Auth] JWT verification failed:', err.message);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// お知らせ作成
app.post('/admin/notifications', requireAdmin, express.json(), async (req, res) => {
  const { title, content, type, scheduled_start, scheduled_end, maintenance_action, is_active } = req.body;
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      title, content, type,
      scheduled_start: scheduled_start || null,
      scheduled_end: scheduled_end || null,
      maintenance_action: maintenance_action ?? 0,
      is_active: is_active ?? true
    })
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});
// お知らせ更新
app.put('/admin/notifications/:id', requireAdmin, express.json(), async (req, res) => {
  const { id } = req.params;
  const { title, content, type, scheduled_start, scheduled_end, maintenance_action, is_active } = req.body;
  const { data, error } = await supabase
    .from('notifications')
    .update({
      title, content, type,
      scheduled_start: scheduled_start || null,
      scheduled_end: scheduled_end || null,
      maintenance_action: maintenance_action ?? 0,
      is_active: is_active ?? true,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select();
  if (error) return res.status(500).json({ error });
  res.json(data[0]);
});

// お知らせ削除（物理削除ではなく論理削除でも可）
app.delete('/admin/notifications/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id);
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});
// お知らせ更新・削除も同様に実装（省略可だが必須）

// 管理者用HTMLを /admin で配信（認証はフロントで行う）
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// /admin/login と /api/admin/login を統一的に書き換え
function createAdminLoginHandler() {
  return async (req, res) => {
    const { id, password } = req.body;
    if (!id || !password) {
      return res.status(400).json({ error: 'ID and password required' });
    }

    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .eq('username', id)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!verifyPassword(password, admin.password)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = jwt.sign(
      { admin: true, username: admin.username, id: admin.id },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ token });
  };
}

// 既存のルート定義を置き換え
app.post('/admin/login', express.json(), createAdminLoginHandler());
app.post('/api/admin/login', express.json(), createAdminLoginHandler());

// 管理者一覧取得
app.get('/api/admin/admins', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('admins')
    .select('id, username, is_active, created_at')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 管理者追加
app.post('/api/admin/admins', requireAdmin, express.json(), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const hashed = hashPassword(password);
  const { data, error } = await supabase
    .from('admins')
    .insert({ username, password: hashed, is_active: true })
    .select('id, username, is_active, created_at')
    .single();
  if (error) {
    // 重複エラーなど
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

// 管理者削除（自分自身は削除不可にしても良い）
app.delete('/api/admin/admins/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  // 自分自身のIDをJWTから取得（オプション）
  // const token = req.headers.authorization.split(' ')[1];
  // const decoded = jwt.verify(token, JWT_SECRET);
  // if (decoded.id == id) return res.status(400).json({ error: '自分自身は削除できません' });

  const { error } = await supabase
    .from('admins')
    .delete()
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});



// お知らせ一覧取得（一般ユーザーと同じだが、管理画面でも使いやすいように）
app.get('/api/admin/notifications', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'DB error' });
  }
  res.json(data);
});

// お知らせ作成
app.post('/api/admin/notifications', requireAdmin, express.json(), async (req, res) => {
  const { title, content, type, scheduled_start, scheduled_end, maintenance_action, is_active } = req.body;
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      title,
      content,
      type,
      scheduled_start: scheduled_start || null,
      scheduled_end: scheduled_end || null,
      maintenance_action: maintenance_action ?? 0,
      is_active: is_active ?? true
    })
    .select();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data[0]);
});

// お知らせ更新
app.put('/api/admin/notifications/:id', requireAdmin, express.json(), async (req, res) => {
  const { id } = req.params;
  const { title, content, type, scheduled_start, scheduled_end, maintenance_action, is_active } = req.body;
  const { data, error } = await supabase
    .from('notifications')
    .update({
      title,
      content,
      type,
      scheduled_start: scheduled_start || null,
      scheduled_end: scheduled_end || null,
      maintenance_action: maintenance_action ?? 0,
      is_active: is_active ?? true,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select();
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data[0]);
});

// お知らせ削除（物理削除）
app.delete('/api/admin/notifications/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id);
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ success: true });
});

// GET /admin/notifications - お知らせ一覧（管理画面用）
app.get('/admin/notifications', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ======================
// メンテナンス即時開始・終了 API
// ======================

// 現在アクティブなメンテナンスを取得
app.get('/api/admin/maintenance/active', requireAdmin, async (req, res) => {
  const now = new Date();
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('type', 'maintenance')
    .eq('is_active', true)
    .lte('scheduled_start', now.toISOString())
    .gte('scheduled_end', now.toISOString())
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

// メンテナンス即時開始
app.post('/api/admin/maintenance/start', requireAdmin, express.json(), async (req, res) => {
  const { title, content, maintenance_action } = req.body;
  const now = new Date();
  const end = new Date(now.getTime() + 60 * 60 * 1000); // 1時間後
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      title: title || 'メンテナンス中',
      content: content || 'システムメンテナンスを実施しています。ご不便をおかけします。',
      type: 'maintenance',
      scheduled_start: now.toISOString(),
      scheduled_end: end.toISOString(),
      maintenance_action: maintenance_action ?? 1,
      is_active: true
    })
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, notification: data[0] });
});

// メンテナンス停止（アクティブなメンテナンスを終了）
app.post('/api/admin/maintenance/stop', requireAdmin, async (req, res) => {
  const now = new Date();
  // 現在アクティブなメンテナンスを検索
  const { data: active, error: findError } = await supabase
    .from('notifications')
    .select('*')
    .eq('type', 'maintenance')
    .eq('is_active', true)
    .lte('scheduled_start', now.toISOString())
    .gte('scheduled_end', now.toISOString());
  if (findError) return res.status(500).json({ error: findError.message });
  if (!active || active.length === 0) {
    return res.json({ success: false, message: '現在アクティブなメンテナンスはありません' });
  }
  // 終了日時を現在に更新（またはis_activeをfalseに）
  const { error: updateError } = await supabase
    .from('notifications')
    .update({ scheduled_end: now.toISOString(), is_active: false })
    .in('id', active.map(n => n.id));
  if (updateError) return res.status(500).json({ error: updateError.message });
  res.json({ success: true });
});

await ensureDefaultAdmin();
   

// api/index.js の最後
export default app;

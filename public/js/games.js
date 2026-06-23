// js/games.js

async function loadGames() {
  const grid = document.getElementById('gameGrid');
  if (!grid) return;

  try {
    const res = await fetch('/Games.json');
    if (!res.ok) throw new Error('Games.json 読み込み失敗');
    const data = await res.json();
    const games = data.games || [];

    grid.innerHTML = '';

    games.forEach(game => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb" data-game="${game.embedUrl}">
          <img src="${game.thumbnail}" alt="${game.title}" style="aspect-ratio:16/9; object-fit:cover;">
        </div>
        <div class="meta" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="info">
            <div class="title">${escapeHtml(game.title)}</div>
            <div class="sub">${escapeHtml(game.description || '')}</div>
          </div>

          <button
            class="open-tab-btn"
            title="新しいタブで開く"
            style="
              width:42px;
              height:42px;
              border:none;
              border-radius:12px;
              background:linear-gradient(135deg,#4f8cff,#2563eb);
              color:#fff;
              font-size:22px;
              font-weight:bold;
              cursor:pointer;
              box-shadow:0 4px 12px rgba(37,99,235,.35);
              transition:.2s;
              flex-shrink:0;
            "
          >
            ⤢
          </button>
        </div>
      `;

      card.querySelector('.thumb').addEventListener('click', () => {
        location.hash = `playgame=${encodeURIComponent(game.embedUrl)}`;
        renderGamePlay(game);
      });

      card.querySelector('.open-tab-btn').addEventListener('click', (e) => {
        e.stopPropagation();

        const win = window.open('about:blank', '_blank');
        if (!win) return;

        win.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ホーム</title>
            <style>
              html,body{
                margin:0;
                width:100%;
                height:100%;
                overflow:hidden;
                background:#000;
              }

              iframe{
                width:100%;
                height:100%;
                border:none;
              }
            </style>
          </head>
          <body>
            <iframe src="${game.embedUrl}" allowfullscreen></iframe>
          </body>
          </html>
        `);

        win.document.close();
      });

      grid.appendChild(card);
    });
  } catch (err) {
    console.error('ゲーム一覧読み込みエラー:', err);
    grid.innerHTML = `<div style="color:#c00;padding:40px;text-align:center;">ゲーム一覧の読み込みに失敗しました</div>`;
  }
}

function renderGamePlay(game) {
  app.innerHTML = `
    <div class="play-fullscreen">
      <iframe src="${game.embedUrl}" frameborder="0" allowfullscreen></iframe>
    </div>
  `;
  toggleFixedSidebar(false);   
}

window.loadGames = loadGames;
window.renderGamePlay = renderGamePlay;

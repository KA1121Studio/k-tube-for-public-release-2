// js/tools.js

async function loadTools() {
  const grid = document.getElementById('toolGrid');
  if (!grid) return;

  try {
    const res = await fetch('/Tools.json');
    if (!res.ok) throw new Error('Tools.json 読み込み失敗');
    const data = await res.json();
    const tools = data.tools || [];

    grid.innerHTML = '';

    tools.forEach(tool => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb" data-tool="${tool.embedUrl}">
          <img src="${tool.thumbnail}" alt="${tool.title}" style="aspect-ratio:16/9; object-fit:cover;">
        </div>
        <div class="meta" style="display:flex;align-items:center;justify-content:space-between;">
          <div class="info">
            <div class="title">${escapeHtml(tool.title)}</div>
            <div class="sub">${escapeHtml(tool.description || '')}</div>
          </div>

          <button
            class="open-tab-btn"
            title="新しいタブで開く"
            style="
              width:42px;
              height:42px;
              border:none;
              border-radius:12px;
              background:linear-gradient(135deg,#34d399,#16a34a);
              color:#fff;
              font-size:22px;
              font-weight:bold;
              cursor:pointer;
              box-shadow:0 4px 12px rgba(37,99,235,.35);
              transition:.2s;
              flex-shrink:0;
            "
          >
            ↗
          </button>
        </div>
      `;

      card.querySelector('.thumb').addEventListener('click', () => {
        location.hash = `playtool=${encodeURIComponent(tool.embedUrl)}`;
        renderToolPlay(tool);
      });

      card.querySelector('.open-tab-btn').addEventListener('click', (e) => {
        e.stopPropagation();

        const win = window.open('about:blank', '_blank');
        if (!win) return;

        win.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ツール</title>
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
            <iframe src="${tool.embedUrl}" allowfullscreen></iframe>
          </body>
          </html>
        `);

        win.document.close();
      });

      grid.appendChild(card);
    });
  } catch (err) {
    console.error('ツール一覧読み込みエラー:', err);
    grid.innerHTML = `<div style="color:#c00;padding:40px;text-align:center;">ツール一覧の読み込みに失敗しました</div>`;
  }
}

function renderToolPlay(tool) {
  app.innerHTML = `
    <div class="play-fullscreen">
      <iframe src="${tool.embedUrl}" frameborder="0" allowfullscreen></iframe>
    </div>
  `;
  toggleFixedSidebar(false);
}

window.loadTools = loadTools;
window.renderToolPlay = renderToolPlay;

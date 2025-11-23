const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// Util: montar manifesto com nome curto e logo oficial
function buildManifest({ name = "Brazuca", logo = "https://i.imgur.com/KVpfrAk.png" } = {}) {
  return {
    id: "brscrap.brazuca.debrid",
    version: "1.0.0",
    name,
    description: "Addon Brazuca Torrents com StremThru e Debrid",
    logo,
    catalogs: [],
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  };
}

// Rota do manifesto estático
app.get("/manifest.json", (req, res) => {
  const manifest = buildManifest();
  res.json(manifest);
});

// Exemplo de gerador de link do addon com configuração (opcional)
app.get("/generate", (req, res) => {
  // Parâmetros esperados (ex.: /generate?debrid=rd&token=XXX&stremthru=true)
  const { debrid = "rd", token = "", stremthru = "true" } = req.query;

  const config = {
    service: debrid === "torbox" ? "torbox" : "rd",
    token: String(token),
    stremthru: String(stremthru) === "true"
  };

  const encoded = Buffer.from(JSON.stringify(config)).toString("base64");
  // Link para instalar no Stremio usando este servidor como base
  const base = `${req.protocol}://${req.get("host")}`;
  const installLink = `${base}/manifest.json?config=${encoded}`;

  res.json({ installLink, config });
});

// Página inicial com layout melhor e botões destacados
app.get("/", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Brazuca Addon</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        :root {
          --bg: #0f1218;
          --card: #161b22;
          --text: #e6edf3;
          --muted: #9da7b1;
          --primary: #0078d7;
          --primary-hover: #005fa3;
          --accent: #ff9800;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color: var(--text);
          background: linear-gradient(180deg, #0c1016 0%, #0f1218 100%);
        }
        .container {
          max-width: 940px; margin: 0 auto; padding: 32px 16px;
        }
        .card {
          background: var(--card);
          border: 1px solid #21262d;
          border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          padding: 24px;
        }
        .header {
          display: flex; align-items: center; gap: 16px; margin-bottom: 8px;
        }
        .header img {
          width: 64px; height: 64px; border-radius: 12px; object-fit: cover;
          border: 1px solid #30363d;
        }
        .title {
          font-size: 28px; font-weight: 700; margin: 0;
        }
        .subtitle { color: var(--muted); margin: 6px 0 18px; }
        .cta-row {
          display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0 8px;
        }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 8px; padding: 12px 18px;
          border-radius: 10px; border: 1px solid transparent;
          color: #fff; text-decoration: none; font-weight: 600;
          transition: all 0.2s ease;
        }
        .btn-primary { background: var(--primary); }
        .btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
        .btn-accent { background: var(--accent); }
        .btn-accent:hover { filter: brightness(0.92); transform: translateY(-1px); }
        .section { margin-top: 22px; }
        .section h2 { font-size: 18px; margin: 0 0 10px; color: var(--text); }
        .muted { color: var(--muted); font-size: 14px; }
        .code {
          background: #0b0e13; border: 1px solid #22272e;
          border-radius: 10px; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: var(--text);
        }
        .footer { margin-top: 28px; color: var(--muted); font-size: 12px; text-align: center; }
        @media (max-width: 600px) {
          .header { flex-direction: column; text-align: center; }
          .header img { width: 80px; height: 80px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="header">
            <img src="https://i.imgur.com/KVpfrAk.png" alt="Logo Brazuca">
            <div>
              <h1 class="title">Brazuca</h1>
              <p class="subtitle">Addon Brazuca Torrents com StremThru e Debrid</p>
            </div>
          </div>

          <div class="cta-row">
            <a href="${base}/manifest.json" class="btn btn-primary">Instalar no Stremio</a>
            <a href="https://real-debrid.com/premium" target="_blank" rel="noopener" class="btn btn-accent">Assinar Real‑Debrid</a>
            <a href="https://torbox.app/premium" target="_blank" rel="noopener" class="btn btn-accent">Assinar Torbox</a>
          </div>

          <div class="section">
            <h2>Gerador de link com configuração</h2>
            <p class="muted">Se quiser gerar um link de instalação com serviço e token embutidos, use o endpoint abaixo:</p>
            <div class="code">
              GET ${base}/generate?debrid=rd&amp;token=SEU_TOKEN&amp;stremthru=true
            </div>
          </div>

          <div class="section">
            <h2>Como instalar</h2>
            <p class="muted">No Stremio, cole o link do manifesto:</p>
            <div class="code">${base}/manifest.json</div>
          </div>

          <div class="footer">
            Versão 4.0.0 • Brazuca StremThru Generator
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

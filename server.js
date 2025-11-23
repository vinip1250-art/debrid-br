const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

// Manifesto do addon
app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "brscrap.brazuca.debrid",
    version: "1.0.0",
    name: "Brazuca",
    description: "Addon Brazuca Torrents com StremThru e Debrid",
    logo: "https://i.imgur.com/KVpfrAk.png",
    catalogs: [],
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  };
  res.json(manifest);
});

// Página inicial
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Brazuca Addon</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f9f9f9; margin: 2rem; text-align: center; }
        h1 { color: #333; }
        p { font-size: 1.1rem; margin-bottom: 2rem; }
        .btn {
          display: inline-block;
          margin: 1rem;
          padding: 1rem 2rem;
          font-size: 1.2rem;
          font-weight: bold;
          color: #fff;
          background: #0078d7;
          border-radius: 8px;
          text-decoration: none;
          transition: background 0.3s;
        }
        .btn:hover { background: #005fa3; }
        .highlight { background: #ff9800; }
        img { max-width: 150px; margin-bottom: 1rem; }
      </style>
    </head>
    <body>
      <img src="https://i.imgur.com/KVpfrAk.png" alt="Logo Brazuca">
      <h1>Addon Brazuca</h1>
      <p>Instale no Stremio ou assine um serviço de Debrid para melhor desempenho:</p>
      <a href="/manifest.json" class="btn">Instalar Addon</a>
      <a href="https://real-debrid.com/premium" class="btn highlight">Assinar Real-Debrid</a>
      <a href="https://torbox.app/premium" class="btn highlight">Assinar Torbox</a>
    </body>
    </html>
  `);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

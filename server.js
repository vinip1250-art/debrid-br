const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// CONFIGURAÇÃO DO REDIS
// ===============================
const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// ===============================
// ROTA PARA GERAR CONFIGURAÇÃO
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  res.json({ id });
});

// ===============================
// MANIFEST STREAM‑ONLY (SEM CATALOGS)
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kv.get(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.0.0",
    name: cfg.nome || "Brazuca Debrid",
    description: "Brazuca Torrents + Debrid Wrapper",
    logo: cfg.icone || "https://i.imgur.com/KVpfrAk.png",

    // STREAM‑ONLY
    types: ["movie", "series"],
    resources: [
      {
        name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt"]
      }
    ]
  });
});

// ===============================
// STREAM (com cache de 10 minutos)
// ===============================
async function streamHandler(req, res) {
  const { id, type, imdb } = req.params;

  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) return res.json({ streams: [] });

  const cacheKey = `cache:${id}:${type}:${imdb}`;
  const cached = await kv.get(cacheKey);

  if (cached) return res.json(cached);

  const upstreams = [];

  // Brazuca Torrents
  upstreams.push({
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
  });

  // Comet (se ativado pelo preset)
  if (cfg.cometa === true) {
    upstreams.push({
      u: "https://comet.feels.legal/eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6MCwibWF4U2l6ZSI6MCwiY2FjaGVkT25seSI6ZmFsc2UsInNvcnRDYWNoZWRVbmNhY2hlZFRvZ2V0aGVyIjpmYWxzZSwicmVtb3ZlVHJhc2giOnRydWUsInJlc3VsdEZvcm1hdCI6WyJhbGwiXSwiZGVicmlkU2VydmljZXMiOltdLCJlbmFibGVUb3JyZW50Ijp0cnVlLCJkZWR1cGxpY2F0ZVN0cmVhbXMiOnRydWUsImRlYnJpZFN0cmVhbVByb3h5UGFzc3dvcmQiOiIiLCJsYW5ndWFnZXMiOnsicmVxdWlyZWQiOlsicHQiXSwiYWxsb3dlZCI6WyJtdWx0aSIsImVuIiwiamEiLCJrbyJdLCJleGNsdWRlIjpbIm11bHRpIiwiZW4iLCJqYSIsInpoIiwicnUiXSwicHJlZmVycmVkIjpbInB0Il19LCJyZXNvbHV0aW9ucyI6eyJyNTc2cCI6ZmFsc2UsInI0ODBwIjpmYWxzZSwicjM2MHAiOmZhbHNlLCJyMjQwcCI6ZmFsc2V9LCJvcHRpb25zIjp7InJlbW92ZV9yYW5rc191bmRlciI6LTEwMDAwMDAwMDAwLCJhbGxvd19lbmdsaXNoX2luX2xhbmd1YWdlcyI6ZmFsc2UsInJlbW92ZV91bmtub3duX2xhbmd1YWdlcyI6ZmFsc2V9fQ==/manifest.json"
    });
  }

  // Serviços de debrid
  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });
  if (cfg.premiumize) stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg.debridlink) stores.push({ c: "dl", t: cfg.debridlink });

  const wrapper = { upstreams, stores };
  const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");

  const stremthruUrl =
    `https://stremthrufortheweebs.midnightignite.me/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  try {
    const { data } = await axios.get(stremthruUrl, {
      timeout: 20000,
      headers: { "User-Agent": "DebridBR/1.0" }
    });

    if (!data || !Array.isArray(data.streams)) {
      return res.json({ streams: [] });
    }

    await kv.set(cacheKey, data, { ex: 600 });
    return res.json(data);
  } catch {
    return res.json({ streams: [] });
  }
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

// ===============================
// DEBUG DO REDIS
// ===============================
app.get("/debug/:key", async (req, res) => {
  try {
    const value = await kv.get(req.params.key);
    res.json({ value });
  } catch (e) {
    res.status(500).json({ error: "Redis não acessível", details: e.message });
  }
});

// ===============================
// SERVE INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

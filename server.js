const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

// REDIS
let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
    console.log("[REDIS] OK");
  }
} catch (err) {
  console.error("[REDIS FAIL]", err.message);
}

async function kvGet(key) {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (err) {
    console.error(`[REDIS GET ${key}]`, err.message);
    return null;
  }
}

async function kvSet(key, value, opts) {
  if (!kv) return;
  try {
    await kv.set(key, value, opts);
  } catch (err) {
    console.error(`[REDIS SET ${key}]`, err.message);
  }
}

// HELPERS
function toB64(obj) {
  return encodeURIComponent(Buffer.from(JSON.stringify(obj)).toString("base64"));
}

function ms(start) {
  return `${Date.now() - start}ms`;
}

function isValidImdb(imdb) {
  return /^tt\d{7,}$/.test(imdb);
}

function dedup(streams) {
  const seen = new Set();
  return streams.filter(s => {
    const key = `${s.infoHash || s.title || ''}|${s.size || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// /gerar
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kvSet(`addon:${id}`, req.body);
  console.log(`[CFG] ${id}`);
  res.json({ id });
});

// /manifest.json
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kvGet(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.6.1",
    name: cfg.nome || "BR Debrid",
    description: "Brazuca + BeTor + Comet + Torrentio",
    logo: cfg.icone || "https://imgur.com/a/hndiKou",
    types: ["movie", "series"],
    resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: []
  });
});

// Comet
function getCometManifest() {
  const cfg = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    removeTrash: true,
    deduplicateStreams: true,
    enableTorrent: true,
    languages: { required: ["pt"], preferred: ["pt"] }
  };
  return `https://comet.feels.legal/${toB64(cfg)}/manifest.json`;
}

// STREMTHRU com retry
async function callWrap(upstreams, stores, type, imdb) {
  const encoded = toB64({ upstreams, stores });
  const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;

  console.log(`[WRAP] ${upstreams.length}us`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const timeout = 8000 * attempt;
    try {
      const { data } = await axios.get(url, {
        timeout,
        headers: { "User-Agent": "DebridBR/1.0" }
      });
      const streams = data.streams || [];
      if (streams.length > 0) {
        console.log(`[WRAP OK] ${streams.length} (${ms(Date.now() - timeout)})`);
        return streams;
      }
    } catch (err) {
      console.log(`[WRAP ${attempt}] ${err.message}`);
      if (err.code !== 'ECONNABORTED') break;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return [];
}

// STREAM
async function streamHandler(req, res) {
  const start = Date.now();
  const { id: addonId, type, imdb } = req.params;

  if (!isValidImdb(imdb)) return res.json({ streams: [] });

  console.log(`\n🎬 ${imdb}`);

  const cfg = await kvGet(`addon:${addonId}`);
  if (!cfg) return res.json({ streams: [] });

  const cacheKey = `cache:${type}:${imdb}`;
  const cached = await kvGet(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT]`);
    return res.json(cached);
  }

  console.log(`[CACHE MISS]`);

  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });

  const upstreams = [
    { u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" },
    { u: "https://betor-scrap.vercel.app/manifest.json" }
  ];

  if (cfg.cometa) upstreams.push({ u: getCometManifest() });
  if (cfg.torrentio) upstreams.push({ 
    u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json" 
  });

  const streams = await callWrap(upstreams, stores, type, imdb);
  const data = { streams: dedup(streams) };

  if (data.streams.length > 0) {
    await kvSet(cacheKey, data, { ex: 3600 });
  }

  console.log(`[${data.streams.length}] ${ms(start)}`);
  res.json(data);
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

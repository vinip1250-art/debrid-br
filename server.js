const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

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
  console.error("[REDIS]", err.message);
}

async function kvGet(key) {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (err) {
    return null;
  }
}

async function kvSet(key, value, opts) {
  if (!kv) return;
  try {
    await kv.set(key, value, opts);
  } catch (err) {}
}

// HELPERS
function toB64(obj) {
  return encodeURIComponent(Buffer.from(JSON.stringify(obj)).toString("base64"));
}

function ms(start) {
  return `${Date.now() - start}ms`;
}

// DEBUG: aceita QUALQUER ID para ver o que chega
function isValidVideoId(id) {
  console.log("[DEBUG ID]", id, "-> VALID");
  return true;
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

// GERAR
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kvSet(`addon:${id}`, req.body);
  console.log(`[CFG] ${id}`);
  res.json({ id });
});

// MANIFEST
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kvGet(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.6.2",
    name: cfg.nome || "BR Debrid + Torz",
    description: "Todos addons + Torz PT-BR",
    logo: cfg.icone || "https://imgur.com/a/hndiKou",
    types: ["movie", "series", "anime"],
    resources: [
      {
        name: "stream",
        types: ["movie", "series", "anime"],
        idPrefixes: ["tt", "kitsu"]
      }
    ],
    catalogs: []
  });
});

// COMET
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

// TORZ PT-BR
function getTorzManifest() {
  const torzCfg = {
    stores: [{ c: "p2p", t: "" }],
    filter: "File.Name matches '(?i)(dublado|dual.5|dual.2|nacional|brazilian|pt-br|ptbr|brasil|brazil|sf|bioma|c76|c0ral|sigma|andrehsa|riper|sigla|eck)'"
  };
  return `https://stremthru.13377001.xyz/stremio/torz/${toB64(torzCfg)}/manifest.json`;
}

// WRAP com debug completo
async function callWrap(upstreams, stores, type, videoId) {
  const encoded = toB64({ upstreams, stores });
  const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${videoId}.json`;

  console.log(`[WRAP URL] ${url}`);
  console.log(`[WRAP upstreams]`, JSON.stringify(upstreams));
  console.log(`[WRAP stores]`, JSON.stringify(stores));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const timeout = 8000 * attempt;
    try {
      const response = await axios.get(url, {
        timeout,
        headers: { "User-Agent": "DebridBR/1.0" }
      });
      console.log(`[WRAP STATUS] ${response.status}`);
      
      const data = response.data;
      const streams = data.streams || [];
      console.log(`[WRAP DATA] streams=${streams.length}`);
      
      if (streams.length > 0) {
        console.log(`[OK] ${streams.length} streams encontrados`);
        return streams;
      } else {
        console.log("[WRAP EMPTY] Sem streams no response");
      }
    } catch (err) {
      console.log(`[WRAP ERR ${attempt}]`, err.code || err.message);
      if (err.response) {
        console.log(`[WRAP ERR RESPONSE]`, err.response.status, err.response.statusText);
      }
      if (err.code !== 'ECONNABORTED') break;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  console.log("[WRAP FAIL] Todas tentativas falharam");
  return [];
}

// STREAM
async function streamHandler(req, res) {
  const start = Date.now();
  const { id: addonId, type, imdb: videoId } = req.params;

  console.log(`
🔍 CHAMADA: addon=${addonId} type=${type} videoId=${videoId}`);

  const cfg = await kvGet(`addon:${addonId}`);
  if (!cfg) {
    console.log("[NO CFG]");
    return res.json({ streams: [] });
  }

  const cacheKey = `cache:${type}:${videoId}`;
  const cached = await kvGet(cacheKey);
  if (cached) {
    console.log("[HIT]");
    return res.json(cached);
  }

  console.log("[MISS]");

  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });

  const upstreams = [
    { u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" },
    { u: "https://betor-scrap.vercel.app/manifest.json" }
  ];

  if (cfg.cometa) upstreams.push({ u: getCometManifest() });
  if (cfg.torrentio)
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
  if (cfg.torz) upstreams.push({ u: getTorzManifest() });

  const streams = await callWrap(upstreams, stores, type, videoId);
  const data = { streams: dedup(streams) };

  if (data.streams.length > 0) {
    await kvSet(cacheKey, data, { ex: 3600 });
  }

  console.log(`[FINAL] ${data.streams.length} streams em ${ms(start)}`);
  res.json(data);
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

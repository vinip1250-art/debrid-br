const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// REDIS COM FALLBACK
// ===============================
let kv = null;

try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    });
    console.log("[REDIS] Inicializado com sucesso");
  } else {
    console.warn("[REDIS] Env vars ausentes, cache desativado");
  }
} catch (err) {
  console.error("[REDIS INIT FAIL]", err.message);
  kv = null;
}

async function kvGet(key) {
  if (!kv) return null;
  try {
    return await kv.get(key);
  } catch (err) {
    console.error(`[REDIS GET FAIL] ${key}: ${err.message}`);
    return null;
  }
}

async function kvSet(key, value, opts) {
  if (!kv) return;
  try {
    await kv.set(key, value, opts);
    console.log(`[CACHE SALVO] ${key}`);
  } catch (err) {
    console.error(`[REDIS SET FAIL] ${key}: ${err.message}`);
  }
}

// ===============================
// HELPERS
// ===============================
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
    const key = `${s.infoHash || ""}|${s.title || ""}|${s.url || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ===============================
// GERAR CONFIG
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kvSet(`addon:${id}`, req.body);
  console.log(`[CFG] ID gerado: ${id}`);
  res.json({ id });
});

// ===============================
// MANIFEST
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kvGet(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.5.0",
    name: cfg.nome || "BR Debrid",
    description: "Brazuca + BeTor + Comet + Torz via StremThru",
    logo: cfg.icone || "https://imgur.com/a/hndiKou",
    types: ["movie", "series"],
    resources: [
      {
        name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt"]
      }
    ],
    catalogs: []
  });
});

// ===============================
// COMET MANIFEST
// ===============================
function getCometManifest() {
  const cometCfg = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    removeTrash: true,
    deduplicateStreams: true,
    enableTorrent: true,
    languages: {
      required: ["pt"],
      preferred: ["pt"]
    }
  };
  return `https://comet.feels.legal/${toB64(cometCfg)}/manifest.json`;
}

// ===============================
// TORZ MANIFEST URL
// ===============================
const TORZ_URL = "https://stremthru.13377001.xyz/stremio/torz/manifest.json";

// ===============================
// CHAMADA STREMTHRU WRAP
// ===============================
async function callWrap(upstreams, stores, type, imdb, timeoutMs) {
  const encoded = toB64({ upstreams, stores });
  const url =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  console.log(`[WRAP] ${upstreams.length} upstreams, timeout ${timeoutMs}ms`);

  const { data } = await axios.get(url, {
    timeout: timeoutMs,
    headers: { "User-Agent": "DebridBR/1.0" }
  });

  return data.streams || [];
}

// ===============================
// STREAM HANDLER
// ===============================
async function streamHandler(req, res) {
  const start = Date.now();
  const { id: addonId, type, imdb } = req.params;

  if (!isValidImdb(imdb)) {
    console.log(`[INVALID] IMDb inválido: ${imdb}`);
    return res.json({ streams: [] });
  }

  console.log(`\n🎬 STREAM REQUEST: ${imdb} (${type})`);

  const cfg = await kvGet(`addon:${addonId}`);
  if (!cfg) {
    console.log("[CFG] Não encontrada");
    return res.json({ streams: [] });
  }

  // Cache
  const cacheKey = `cache:${type}:${imdb}`;
  const cached = await kvGet(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${imdb} (${ms(start)})`);
    return res.json(cached);
  }

  console.log(`[CACHE MISS] ${imdb}`);

  // Stores (debrid)
  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });

  console.log("[DEBRIDS]", stores.length ? stores.map(s => s.c).join(", ") : "nenhum");

  // Upstreams principais (sem Torz)
  const mainUpstreams = [
    { u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" },
    { u: "https://betor-scrap.vercel.app/manifest.json" }
  ];

  if (cfg.cometa === true) {
    mainUpstreams.push({ u: getCometManifest() });
    console.log("[UPSTREAM] Comet adicionado");
  }

  if (cfg.torrentio === true) {
    mainUpstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
    console.log("[UPSTREAM] Torrentio adicionado");
  }

  // Upstreams Torz (separado)
  const torzUpstreams = [{ u: TORZ_URL }];

  console.log("[UPSTREAMS MAIN]", mainUpstreams.length);
  console.log("[UPSTREAMS TORZ]", torzUpstreams.length);

  // Dispara as duas chamadas ao wrap em paralelo:
  // - Chamada principal: sem Torz, timeout 7s
  // - Chamada Torz: só Torz, timeout 12s
  const [mainResult, torzResult] = await Promise.allSettled([
    callWrap(mainUpstreams, stores, type, imdb, 7000),
    callWrap(torzUpstreams, stores, type, imdb, 12000)
  ]);

  const mainStreams = mainResult.status === "fulfilled"
    ? mainResult.value
    : [];

  const torzStreams = torzResult.status === "fulfilled"
    ? torzResult.value
    : [];

  if (mainResult.status === "rejected") {
    console.log(`[MAIN FAIL] ${mainResult.reason?.message}`);
  } else {
    console.log(`[MAIN OK] ${mainStreams.length} streams`);
  }

  if (torzResult.status === "rejected") {
    console.log(`[TORZ FAIL] ${torzResult.reason?.message}`);
  } else {
    console.log(`[TORZ OK] ${torzStreams.length} streams`);
  }

  // Merge: main primeiro (prioridade), Torz depois
  const merged = dedup([...mainStreams, ...torzStreams]);

  console.log(`[MERGE] ${merged.length} streams únicos (${ms(start)})`);

  const data = { streams: merged };

  // Salva no cache se tem resultado (TTL 1800s = 30min)
  if (merged.length > 0) {
    await kvSet(cacheKey, data, { ex: 1800 });
  }

  console.log(`[TOTAL] ${ms(start)}`);
  return res.json(data);
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

// ===============================
// INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

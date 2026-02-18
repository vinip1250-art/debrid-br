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
    version: "3.4.0",
    name: cfg.nome || "BR Debrid",
    description: "Brazuca + BeTor + Comet + Torz (com fallback)",
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
// STREMTHRU (com debrid)
// ===============================
async function callStremthru(upstreams, stores, type, imdb) {
  const encoded = toB64({ upstreams, stores });
  const url =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  console.log("[STREMTHRU URL]", url);

  const { data } = await axios.get(url, {
    timeout: 7000,
    headers: { "User-Agent": "DebridBR/1.0" }
  });
  return data;
}

// ===============================
// UPSTREAM INDIVIDUAL (fallback)
// ===============================
async function getStreamsFromUpstream(manifestUrl, type, imdb) {
  const baseUrl = manifestUrl.replace(/\/manifest\.json$/, "");
  const url = `${baseUrl}/stream/${type}/${imdb}.json`;
  try {
    const { data } = await axios.get(url, {
      timeout: 3000,
      headers: { "User-Agent": "DebridBR/1.0" }
    });
    const streams = data.streams || [];
    console.log(`[UPSTREAM OK] ${manifestUrl} -> ${streams.length} streams`);
    return streams;
  } catch (err) {
    console.log(`[UPSTREAM FAIL] ${manifestUrl}: ${err.message}`);
    return [];
  }
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

  // Upstreams
  const upstreams = [
    { u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" },
    { u: "https://betor-scrap.vercel.app/manifest.json" }
  ];

  if (cfg.cometa === true) {
    const cometUrl = getCometManifest();
    upstreams.push({ u: cometUrl });
    console.log("[UPSTREAM] Comet adicionado");
  }

  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
    console.log("[UPSTREAM] Torrentio adicionado");
  }

  console.log("[UPSTREAMS]", upstreams.map((u, i) => `${i + 1}. ${u.u}`).join(" | "));

  const stores = [];
  if (cfg.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox) stores.push({ c: "tb", t: cfg.torbox });

  console.log("[DEBRIDS]", stores.length ? stores.map(s => s.c).join(", ") : "nenhum");

  let data = { streams: [] };

  // Tenta stremthru primeiro
  try {
    console.log("[STREMTHRU] Tentando...");
    data = await callStremthru(upstreams, stores, type, imdb);

    if (!data.streams || data.streams.length === 0) {
      throw new Error("Sem streams retornados");
    }

    console.log(`[STREMTHRU OK] ${data.streams.length} streams (${ms(start)})`);
  } catch (err) {
    console.log(`[STREMTHRU FAIL] ${err.message} (${ms(start)})`);
    console.log("[FALLBACK] Buscando upstreams individualmente...");

    // Fallback paralelo nos upstreams públicos
    const promises = upstreams.map(up =>
      getStreamsFromUpstream(up.u, type, imdb)
    );

    const results = await Promise.allSettled(promises);

    const allStreams = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value)
      .filter(Boolean);

    // Deduplicação simples por título + resolução + tamanho
    const seen = new Set();
    data.streams = allStreams.filter(stream => {
      const key = `${stream.title || ""}|${stream.resolution || ""}|${stream.size || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.log(`[FALLBACK OK] ${data.streams.length} streams únicos (${ms(start)})`);
  }

  // Salva no cache se tem resultado (TTL 30min = 1800s)
  if (data.streams && data.streams.length > 0) {
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

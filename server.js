const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
});

// ===============================
function getCometManifest() {
  const cometCfg = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    removeTrash: true,
    deduplicateStreams: true,
    enableTorrent: true,
    languages: { required: ["pt"], preferred: ["pt"] }
  };
  return `https://comet.feels.legal/${Buffer.from(JSON.stringify(cometCfg)).toString("base64")}/manifest.json`;
}

const COMET_MANIFEST_URL = getCometManifest();

function buildUpstreamsAndStores(cfg, imdb) {
  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [];

  upstreams.push({ u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" });
  
  if (!isAnime) {
    upstreams.push({ u: "https://betor-scrap.vercel.app/manifest.json" });
    upstreams.push({ u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json" });
  }

  if (cfg.cometa === true) upstreams.push({ u: COMET_MANIFEST_URL });
  if (cfg.torrentio === true) upstreams.push({
    u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
  });

  const stores = [];
  if (cfg.realdebrid)  stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox)      stores.push({ c: "tb", t: cfg.torbox });
  if (cfg.premiumize)  stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg.debridlink)  stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg.alldebrid)   stores.push({ c: "ad", t: cfg.alldebrid });

  return { upstreams, stores };
}

// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("🧩 CFG:", id);
  res.json({ id });
});

// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  try {
    const cfg = await kv.get(`addon:${req.params.id}`);
    if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });
    res.json({
      id: `brazuca-debrid-${req.params.id}`,
      version: "3.9.1", // Atualizado!
      name: cfg.nome || "BRDebrid",
      description: "Brazuca + Betor + Dfindexer + Comet (Cache Background)",
      logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",
      types: ["movie", "series", "anime"],
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "kitsu"] }],
      catalogs: [],
      behaviorHints: { configurable: true, configurationRequired: false }
    });
  } catch (err) {
    console.error("Manifest:", err);
    res.status(500).json({ error: "Erro" });
  }
});

// ===============================
async function fetchStreamsFast(upstreams, stores, type, imdb) {
  const promises = upstreams.map(async (upstream) => {
    try {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      const { data } = await axios.get(url, { timeout: 20000 });
      return data.streams || [];
    } catch {
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  return results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
}

// ===============================
async function fetchStreamsComplete(upstreams, stores, type, imdb) {
  console.log("⏳ Background: Esperando TODOS (45s máx)...");
  
  const promises = upstreams.map(async (upstream, i) => {
    try {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      
      // Timeout 40s para lentos (Dfindexer)
      const { data } = await axios.get(url, { timeout: 40000 });
      console.log(`✅ Bg ${i+1}: ${data.streams?.length || 0} streams`);
      return data.streams || [];
    } catch (err) {
      console.log(`⚠️  Bg ${i+1}: timeout`);
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  const completeStreams = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
  console.log(`💾 Cache COMPLETO: ${completeStreams.length} streams`);
  
  return { streams: completeStreams };
}

// ===============================
app.get("/:id/stream/:type/:imdb.json", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    
    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) return res.json({ streams: [] });

    const cacheKey = `cache:${id}:${type}:${imdb}`;
    const cached = await kv.get(cacheKey);
    if (cached) {
      console.log("💾 CACHE HIT (completo)");
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log(`🎬 ${type}/${imdb} → ${upstreams.length} upstreams`);

    // 🚀 RESPOSTA RÁPIDA (20s timeout)
    const fastStreams = await fetchStreamsFast(upstreams, stores, type, imdb);
    const response = { streams: fastStreams };

    // 🔥 BACKGROUND: Cache COMPLETO (45s timeout)
    (async () => {
      try {
        // Timeout total 50s pro background
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Background timeout')), 50000)
        );
        
        const completeResponse = await Promise.race([
          fetchStreamsComplete(upstreams, stores, type, imdb),
          timeoutPromise
        ]);
        
        // Só salva se MELHOR que o atual
        if (completeResponse.streams.length > fastStreams.length) {
          await kv.set(cacheKey, completeResponse, { ex: 1800 });
          console.log("🔥 Cache ATUALIZADO (melhorou!)");
        }
      } catch (err) {
        console.log("⏰ Background timeout OK");
      }
    })();

    // Resposta imediata!
    console.log(`📤 RÁPIDO: ${fastStreams.length} streams (cache em bg)`);
    res.json(response);

  } catch (err) {
    console.error("Erro:", err.message);
    res.status(500).json({ streams: [], error: "Erro interno" });
  }
});

app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

// ===============================
app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  const { id, type, imdb } = req.params;
  const cfg = await kv.get(`addon:${id}`);
  const { upstreams } = buildUpstreamsAndStores(cfg, imdb);
  res.json({ upstreams: upstreams.length, imdb, type });
});

// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

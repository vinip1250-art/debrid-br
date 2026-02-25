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

  upstreams.push({ 
    name: "Brazuca", 
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" 
  });
  
  if (!isAnime) {
    upstreams.push({ 
      name: "Betor", 
      u: "https://betor-scrap.vercel.app/manifest.json" 
    });
    upstreams.push({ 
      name: "Dfindexer", 
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json" 
    });
  }

  if (cfg.cometa === true) upstreams.push({ 
    name: "Comet", 
    u: COMET_MANIFEST_URL 
  });
  if (cfg.torrentio === true) upstreams.push({
    name: "Torrentio", 
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
      version: "3.9.3-FIX",
      name: cfg.nome || "BRDebrid Pro",
      description: "Cache Background + Dfindexer Fix",
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
async function fetchWithTimeout(upstreams, stores, type, imdb, timeoutMs, phase = "fast") {
  const promises = upstreams.map(async (upstream, i) => {
    try {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      
      const response = await axios.get(url, { 
        timeout: timeoutMs,
        headers: { "User-Agent": `DebridBR-${phase}/1.0` }
      });
      
      const count = response.data.streams?.length || 0;
      if (count > 0) {
        console.log(`✅ ${phase} ${upstream.name || i+1} [${timeoutMs/1000}s]: ${count}`);
      }
      return response.data.streams || [];
    } catch (err) {
      return [];
    }
  });

  const results = await Promise.allSettled(promises);
  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(s => s);
}

// ===============================
async function fetchStreamsFast(upstreams, stores, type, imdb) {
  console.log("⚡ Busca RÁPIDA (2 fases anti-vazio)...");
  
  let streams = await fetchWithTimeout(upstreams, stores, type, imdb, 12000, "fast1");
  
  if (streams.length === 0) {
    console.log("🔄 Fase 2 ativada...");
    streams = await fetchWithTimeout(upstreams, stores, type, imdb, 8000, "fast2");
  }
  
  console.log(`⚡ RÁPIDO: ${streams.length} streams`);
  return streams;
}

// ===============================
async function fetchStreamsComplete(upstreams, stores, type, imdb) {
  console.log("⏳ Background COMPLETO (60s máx)...");
  
  const promises = upstreams.map(async (upstream, i) => {
    try {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      
      // 60s pro Dfindexer!
      const { data } = await axios.get(url, { timeout: 60000 });
      const count = data.streams?.length || 0;
      console.log(`✅ Bg ${upstream.name || i+1}: ${count} streams`);
      return data.streams || [];
    } catch (err) {
      console.log(`⚠️ Bg ${upstream.name || i+1}: timeout`);
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
      console.log("💾 CACHE HIT:", cached.streams.length, "streams");
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log(`🎬 ${type}/${imdb} → ${upstreams.length} upstreams`);

    // 🚀 RESPOSTA RÁPIDA
    const fastStreams = await fetchStreamsFast(upstreams, stores, type, imdb);
    const response = { streams: fastStreams };

    // 🔥 BACKGROUND CACHE (SEMPRE salva!)
    (async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bg timeout')), 65000)
        );
        
        const completeResponse = await Promise.race([
          fetchStreamsComplete(upstreams, stores, type, imdb),
          timeoutPromise
        ]);
        
        // ✅ SEMPRE salva (mesmo se pior)
        await kv.set(cacheKey, completeResponse);
        await kv.expire(cacheKey, 1800); // 30min separado!
        console.log("💾 Cache SALVO (Dfindexer incluso)");
        
      } catch (err) {
        console.log("⏰ Background timeout - sem cache completo");
      }
    })();

    console.log(`📤 Enviando rápido: ${fastStreams.length} streams`);
    res.json(response);

  } catch (err) {
    console.error("🚨 Erro geral:", err.message);
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
  if (!cfg) return res.json({ error: "CFG não encontrada" });
  
  const { upstreams } = buildUpstreamsAndStores(cfg, imdb);
  res.json({ 
    upstreams: upstreams.map(u => u.name), 
    count: upstreams.length,
    imdb, 
    type
  });
});

// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

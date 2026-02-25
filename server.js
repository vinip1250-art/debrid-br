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

  upstreams.push({ name: "Brazuca", u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" });
  
  if (!isAnime) {
    upstreams.push({ name: "Betor", u: "https://betor-scrap.vercel.app/manifest.json" });
    upstreams.push({ name: "Dfindexer", u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json" });
  }

  if (cfg.cometa === true) upstreams.push({ name: "Comet", u: COMET_MANIFEST_URL });
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

app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("🧩 CFG:", id);
  res.json({ id });
});

app.get("/:id/manifest.json", async (req, res) => {
  try {
    const cfg = await kv.get(`addon:${req.params.id}`);
    if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });
    res.json({
      id: `brazuca-debrid-${req.params.id}`,
      version: "4.0.0-ANTIRATE",
      name: cfg.nome || "BRDebrid Anti-RateLimit",
      description: "Fast + Background Sequencial",
      logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",
      types: ["movie", "series", "anime"],
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "kitsu"] }],
      catalogs: [],
      behaviorHints: { configurable: true, configurationRequired: false }
    });
  } catch (err) {
    res.status(500).json({ error: "Erro" });
  }
});

// ===============================
async function fetchOneStream(upstream, stores, type, imdb, timeoutMs = 20000, label = "") {
  try {
    const wrapper = { upstreams: [upstream], stores };
    const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
    const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
    
    const { data } = await axios.get(url, { 
      timeout: timeoutMs,
      headers: { "User-Agent": `DebridBR-${label}/1.0` }
    });
    
    const count = data.streams?.length || 0;
    if (count > 0) console.log(`✅ ${label} ${upstream.name}: ${count}`);
    return data.streams || [];
  } catch (err) {
    console.log(`⚠️  ${label} ${upstream.name}: timeout`);
    return [];
  }
}

// ===============================
async function fetchStreamsFast(upstreams, stores, type, imdb) {
  console.log("⚡ RÁPIDO (3 paralelos máx)...");
  
  // Máx 3 simultâneos (anti-rate)
  const limit3 = (promises) => {
    const results = [];
    for (let i = 0; i < promises.length; i += 3) {
      results.push(...await Promise.allSettled(promises.slice(i, i + 3)));
    }
    return results;
  };

  const promises = upstreams.slice(0, 9).map((u, i) => // Primeiros 9
    fetchOneStream(u, stores, type, imdb, 12000, `fast${i}`)
  );

  const results = await limit3(promises);
  const streams = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(s => s);

  console.log(`⚡ RÁPIDO: ${streams.length} streams`);
  return streams;
}

// ===============================
async function fetchStreamsComplete(upstreams, stores, type, imdb) {
  console.log("⏳ Background SEQUENCIAL (5s delay)...");
  const allStreams = [];

  for (const [i, upstream] of upstreams.entries()) {
    const streams = await fetchOneStream(upstream, stores, type, imdb, 45000, `bg${i}`);
    allStreams.push(...streams);
    
    // Delay anti-rate limit
    if (i < upstreams.length - 1) {
      console.log(`⏳ Aguardando 5s... (${i + 1}/${upstreams.length})`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`💾 COMPLETO: ${allStreams.length} streams (${upstreams.length} addons)`);
  return { streams: allStreams };
}

// ===============================
app.get("/:id/stream/:type/:imdb.json", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    
    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) return res.json({ streams: [] });

    const cacheKey = `cache:${id}:${type}:${imdb}`;
    const cached = await kv.get(cacheKey);
    if (cached && cached.streams && cached.streams.length > 0) {
      console.log("💾 CACHE HIT:", cached.streams.length);
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log(`🎬 ${type}/${imdb} → ${upstreams.length} addons`);

    const fastStreams = await fetchStreamsFast(upstreams, stores, type, imdb);
    const response = { streams: fastStreams };

    // Background SEQUENCIAL (sem rate limit!)
    (async () => {
      try {
        const completeResponse = await fetchStreamsComplete(upstreams, stores, type, imdb);
        
        // Salva SEMPRE se tiver streams
        if (completeResponse.streams.length > 0) {
          await kv.set(cacheKey, completeResponse);
          await kv.expire(cacheKey, 1800);
          console.log("💾 Cache SALVO completo!");
        }
      } catch (err) {
        console.log("❌ Background falhou");
      }
    })();

    console.log(`📤 Rápido: ${fastStreams.length}`);
    res.json(response);

  } catch (err) {
    console.error("Erro:", err.message);
    res.status(500).json({ streams: [], error: "Erro" });
  }
});

app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  const { id, type, imdb } = req.params;
  const cfg = await kv.get(`addon:${id}`);
  const { upstreams } = buildUpstreamsAndStores(cfg, imdb);
  res.json({ upstreams: upstreams.map(u => u.name), imdb, type });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

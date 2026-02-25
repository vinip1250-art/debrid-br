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
  const upstreams = [
    { name: "Brazuca", u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" }
  ];
  
  if (!isAnime) {
    upstreams.push({ name: "Betor", u: "https://betor-scrap.vercel.app/manifest.json" });
    upstreams.push({ name: "Dfindexer", u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json" });
  }

  if (cfg?.cometa) upstreams.push({ name: "Comet", u: COMET_MANIFEST_URL });
  if (cfg?.torrentio) upstreams.push({
    name: "Torrentio", 
    u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
  });

  const stores = [];
  if (cfg?.realdebrid) stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg?.torbox) stores.push({ c: "tb", t: cfg.torbox });
  if (cfg?.premiumize) stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg?.debridlink) stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg?.alldebrid) stores.push({ c: "ad", t: cfg.alldebrid });

  return { upstreams, stores };
}

app.post("/gerar", async (req, res) => {
  try {
    const id = Math.random().toString(36).substring(2, 10);
    await kv.set(`addon:${id}`, req.body);
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: "Erro gerar" });
  }
});

app.get("/:id/manifest.json", async (req, res) => {
  try {
    const cfg = await kv.get(`addon:${req.params.id}`);
    if (!cfg) return res.status(404).json({ error: "Não encontrado" });
    
    res.json({
      id: `brazuca-debrid-${req.params.id}`,
      version: "4.0.1-STABLE",
      name: cfg.nome || "BRDebrid",
      description: "Estável + Cache Background",
      logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",
      types: ["movie", "series", "anime"],
      resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt", "kitsu"] }],
      catalogs: [],
      behaviorHints: { configurable: true, configurationRequired: false }
    });
  } catch (err) {
    res.status(500).json({ error: "Manifest erro" });
  }
});

async function fetchOneStream(upstream, stores, type, imdb, timeout = 20000, label = "fetch") {
  try {
    const wrapper = { upstreams: [upstream], stores };
    const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
    const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
    
    const { data } = await axios.get(url, { 
      timeout,
      headers: { "User-Agent": `DebridBR-${label}/1.0` }
    });
    
    return data.streams || [];
  } catch {
    return [];
  }
}

app.get("/:id/stream/:type/:imdb.json", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) return res.json({ streams: [] });

    const cacheKey = `cache:${id}:${type}:${imdb}`;
    const cached = await kv.get(cacheKey);
    if (cached?.streams?.length > 0) {
      console.log("💾 CACHE HIT:", cached.streams.length);
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log("🎬", type, imdb, upstreams.length, "addons");

    // RÁPIDO: 3 paralelos simples
    const fastPromises = upstreams.slice(0, 3).map(u => 
      fetchOneStream(u, stores, type, imdb, 15000, "fast")
    );
    
    const fastResults = await Promise.allSettled(fastPromises);
    const fastStreams = fastResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .filter(Boolean);

    const response = { streams: fastStreams };
    console.log("⚡ Rápido:", fastStreams.length);

    // Background SEQUENCIAL simples
    (async () => {
      console.log("⏳ Background...");
      const bgStreams = [];
      
      for (const upstream of upstreams) {
        const streams = await fetchOneStream(upstream, stores, type, imdb, 45000, "bg");
        bgStreams.push(...streams);
        
        // Delay 3s anti-rate
        await new Promise(r => setTimeout(r, 3000));
      }

      if (bgStreams.length > 0) {
        await kv.set(cacheKey, { streams: bgStreams });
        await kv.expire(cacheKey, 1800);
        console.log("💾 Cache salvo:", bgStreams.length);
      }
    })();

    res.json(response);
  } catch (err) {
    console.error("500:", err.message);
    res.status(500).json({ streams: [], error: "Erro servidor" });
  }
});

app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    const cfg = await kv.get(`addon:${id}`);
    const { upstreams } = buildUpstreamsAndStores(cfg, imdb);
    res.json({ addons: upstreams.map(u => u.name), total: upstreams.length });
  } catch {
    res.json({ error: "Debug falhou" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

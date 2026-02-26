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
// COMET — manifesto dinâmico
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

// ===============================
// HELPERS: montar upstreams + debrids
// ===============================
function buildUpstreamsAndStores(cfg, imdb) {
  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [
    { name: "Brazuca", u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" }
  ];

  if (!isAnime) {
    upstreams.push({ name: "Betor", u: "https://betor-scrap.vercel.app/manifest.json" });
    upstreams.push({
      name: "Dfindexer",
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json"
    });
  }

  if (cfg?.cometa) {
    upstreams.push({ name: "Comet", u: COMET_MANIFEST_URL });
  }

  if (cfg?.torrentio) {
    upstreams.push({
      name: "Torrentio",
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
  }

  const stores = [];
  if (cfg?.realdebrid)  stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg?.torbox)      stores.push({ c: "tb", t: cfg.torbox });
  if (cfg?.premiumize)  stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg?.debridlink)  stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg?.alldebrid)   stores.push({ c: "ad", t: cfg.alldebrid });

  return { upstreams, stores };
}

// ===============================
// HELPERS: validação de APIs de debrid
// ===============================

// Real‑Debrid: GET https://api.real-debrid.com/rest/1.0/user com Authorization: Bearer <token> [web:86]
async function validateRealDebrid(token) {
  if (!token) return true;
  try {
    const resp = await axios.get("https://api.real-debrid.com/rest/1.0/user", {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// TorBox: GET https://api.torbox.app/api/user/me com Authorization: Bearer <token> [web:108]
async function validateTorbox(token) {
  if (!token) return true;
  try {
    const resp = await axios.get("https://api.torbox.app/api/user/me", {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

// AllDebrid: GET https://api.alldebrid.com/v4/user?agent=<nome>&apikey=<token> [web:93][web:98]
async function validateAllDebrid(token) {
  if (!token) return true;
  try {
    const params = new URLSearchParams({
      agent: "BRDebridAddon",
      apikey: token
    });
    const resp = await axios.get(`https://api.alldebrid.com/v4/user?${params.toString()}`, {
      timeout: 8000
    });
    return resp.data && resp.data.status === "success";
  } catch {
    return false;
  }
}

// (Opcional) você pode adicionar Premiumize, Debrid-Link depois:
// async function validatePremiumize(token) { ... }
// async function validateDebridLink(token) { ... }

// ===============================
// ROTA PARA GERAR CONFIGURAÇÃO (COM VALIDAÇÃO)
// ===============================
app.post("/gerar", async (req, res) => {
  try {
    const cfg = req.body || {};

    // valida em paralelo o que foi preenchido
    const [okRD, okTB, okAD] = await Promise.all([
      validateRealDebrid(cfg.realdebrid),
      validateTorbox(cfg.torbox),
      validateAllDebrid(cfg.alldebrid)
    ]);

    const errors = [];
    if (cfg.realdebrid && !okRD) errors.push("Real-Debrid inválido");
    if (cfg.torbox && !okTB)     errors.push("TorBox inválido");
    if (cfg.alldebrid && !okAD)  errors.push("AllDebrid inválido");

    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Uma ou mais API keys são inválidas",
        details: errors
      });
    }

    const id = Math.random().toString(36).substring(2, 10);
    await kv.set(`addon:${id}`, cfg);
    console.log("🧩 CFG criada:", id);
    return res.json({ ok: true, id });
  } catch (err) {
    console.error("Erro em /gerar:", err.message);
    return res.status(500).json({ ok: false, error: "Erro interno" });
  }
});

// ===============================
// MANIFEST
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  try {
    const cfg = await kv.get(`addon:${req.params.id}`);
    if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

    res.json({
      id: `brazuca-debrid-${req.params.id}`,
      version: "4.1.0",
      name: cfg.nome || "BRDebrid",
      description: "Brazuca + Betor + Dfindexer + Comet + Torrentio (cache + validação de debrid)",
      logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",
      types: ["movie", "series", "anime"],
      resources: [
        {
          name: "stream",
          types: ["movie", "series"],
          idPrefixes: ["tt", "kitsu"]
        }
      ],
      catalogs: [],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    });
  } catch (err) {
    console.error("Manifest error:", err.message);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===============================
// FETCH AUXILIAR PARA UM UPSTREAM
// ===============================
async function fetchOneStream(upstream, stores, type, imdb, timeout = 20000, label = "fast") {
  try {
    const wrapper = { upstreams: [upstream], stores };
    const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
    const url =
      `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
      `/stream/${type}/${imdb}.json`;

    const { data } = await axios.get(url, {
      timeout,
      headers: { "User-Agent": `BRDebrid-${label}/1.0` }
    });

    const count = data.streams?.length || 0;
    if (count > 0) {
      console.log(`✅ ${label} ${upstream.name}: ${count} streams`);
    }
    return data.streams || [];
  } catch (err) {
    console.log(`⚠️ ${label} ${upstream.name}: ${err.code || err.message}`);
    return [];
  }
}

// ===============================
// STREAM: resposta rápida + cache background simples
// ===============================
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
    console.log(`🎬 ${type}/${imdb} → ${upstreams.length} upstreams`);

    // resposta rápida: até 3 upstreams em paralelo
    const fastUpstreams = upstreams.slice(0, 3);
    const fastPromises = fastUpstreams.map(u =>
      fetchOneStream(u, stores, type, imdb, 15000, "fast")
    );

    const fastResults = await Promise.allSettled(fastPromises);
    const fastStreams = fastResults
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value)
      .filter(Boolean);

    console.log(`⚡ Rápido: ${fastStreams.length} streams`);

    const response = { streams: fastStreams };

    // background: consulta todos sequencialmente e salva cache se achar algo
    (async () => {
      try {
        console.log("⏳ Background completo...");
        const allStreams = [];

        for (const upstream of upstreams) {
          const streams = await fetchOneStream(upstream, stores, type, imdb, 45000, "bg");
          allStreams.push(...streams);
          // delay leve para evitar rate limit
          await new Promise(r => setTimeout(r, 3000));
        }

        console.log(`💾 Background encontrou: ${allStreams.length} streams`);
        if (allStreams.length > 0) {
          await kv.set(cacheKey, { streams: allStreams });
          await kv.expire(cacheKey, 1800);
          console.log("💾 Cache salvo (background)");
        }
      } catch (e) {
        console.log("Background falhou:", e.message);
      }
    })();

    return res.json(response);
  } catch (err) {
    console.error("Stream error:", err.message);
    return res.status(500).json({ streams: [], error: "Erro interno" });
  }
});

// redireciono a rota sem .json
app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

// ===============================
// DEBUG
// ===============================
app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) return res.json({ error: "CFG não encontrada" });

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    res.json({
      imdb,
      type,
      upstreams: upstreams.map(u => u.name),
      debrids: stores.map(s => s.c)
    });
  } catch {
    res.json({ error: "Debug falhou" });
  }
});

// ===============================
// INDEX (frontend)
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

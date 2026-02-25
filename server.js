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
// COMET — gerado dinamicamente
// Modo P2P (sem debrid), idioma requerido PT.
// Os debrids do usuário são injetados pelo Stremthru no wrap.
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

  const encoded = Buffer.from(JSON.stringify(cometCfg)).toString("base64");
  return `https://comet.feels.legal/${encoded}/manifest.json`;
}

// Pré-computado uma vez (config é estática, não depende do usuário)
const COMET_MANIFEST_URL = getCometManifest();

// ===============================
// FUNÇÃO AUXILIAR (DRY)
// ===============================
function buildUpstreamsAndStores(cfg, imdb) {
  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [];

  // Brazuca — suporta filmes, séries e animes
  upstreams.push({
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
  });

  // Betor — apenas IDs IMDB (tt), não suporta kitsu
  if (!isAnime) {
    upstreams.push({
      u: "https://betor-scrap.vercel.app/manifest.json"
    });
  }

  // Dfindexer — apenas IDs IMDB (tt), não suporta kitsu
  if (!isAnime) {
    upstreams.push({
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json"
    });
  }

  // Comet — P2P + idioma PT, debrids injetados pelo Stremthru
  if (cfg.cometa === true) {
    upstreams.push({ u: COMET_MANIFEST_URL });
  }

  // Torrentio — suporta kitsu nativamente (nyaasi/tokyotosho/anidex/nekobt)
  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
  }

  // Serviços de debrid — passados ao Stremthru para o wrap
  const stores = [];
  if (cfg.realdebrid)  stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox)      stores.push({ c: "tb", t: cfg.torbox });
  if (cfg.premiumize)  stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg.debridlink)  stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg.alldebrid)   stores.push({ c: "ad", t: cfg.alldebrid }); // código diferente de "dl"

  return { isAnime, upstreams, stores };
}

// ===============================
// ROTA PARA GERAR CONFIGURAÇÃO
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("🧩 CFG criada:", id, req.body);
  res.json({ id });
});

// ===============================
// MANIFEST
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kv.get(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.9.0",
    name: cfg.nome || "BRDebrid",
    description: "Brazuca + Betor + Torrentio + Comet",
    logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",

    types: ["movie", "series", "anime"],

    resources: [
      {
        name: "stream",
        // Animes via Kitsu chegam com type "series" + id "kitsu:xxx"
        // Não existe type "anime" em streams no protocolo Stremio
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
});

// ===============================
// STREAM (com cache 30 min + logs)
// ===============================
async function streamHandler(req, res) {
  const { id, type, imdb } = req.params;

  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) return res.json({ streams: [] });

  const cacheKey = `cache:${id}:${type}:${imdb}`;
  const cached = await kv.get(cacheKey);

  if (cached) {
    console.log("CACHE HIT →", imdb);
    return res.json(cached);
  }

  console.log("CACHE MISS →", imdb);

  const { isAnime, upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);

  // LOGS
  console.log(`TIPO: ${isAnime ? "ANIME (kitsu)" : "FILME/SÉRIE (tt)"}`);
  console.log("UPSTREAMS ATIVOS:");
  upstreams.forEach(u => console.log("→", u.u));
  console.log("DEBRID CONFIGURADOS:");
  stores.forEach(s => console.log("→", s.c));

  const wrapper = { upstreams, stores };
  const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");

  const stremthruUrl =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  console.log("URL FINAL →", stremthruUrl);

  try {
    const { data } = await axios.get(stremthruUrl, {
      timeout: 20000,
      headers: { "User-Agent": "DebridBR/1.0" }
    });

    console.log("STREAMS RECEBIDOS:", data.streams?.length || 0);

    // Cache seletivo — 30 minutos
    if (data.streams && data.streams.length > 0) {
      await kv.set(cacheKey, data, { ex: 1800 });
      console.log("CACHE SALVO ✔ (30 min)");
    } else {
      console.log("CACHE NÃO SALVO (streams vazios)");
    }

    return res.json(data);
  } catch (err) {
    console.error("ERRO NO STREMTHRU:", err.message);
    return res.json({ streams: [], error: "Falha ao buscar streams" });
  }
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

// ===============================
// ROTA DE DEBUG
// ===============================
app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  const { id, type, imdb } = req.params;
  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) return res.json({ error: "Configuração não encontrada" });

  const { isAnime, upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);

  const wrapper = { upstreams, stores };
  const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");

  const stremthruUrl =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  res.json({ isAnime, cometManifestUrl: COMET_MANIFEST_URL, wrapper, stremthruUrl });
});

// ===============================
// SERVE INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

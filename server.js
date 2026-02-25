const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");
const pLimit = require("p-limit"); // npm install p-limit

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
  if (cfg.alldebrid)   stores.push({ c: "ad", t: cfg.alldebrid });

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
// STREAM PARALELO (timeout individual 20s + p-limit 3)
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

  console.log("🚀 CACHE MISS →", imdb);

  const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);

  // LOGS iniciais
  console.log("📡 UPSTREAMS:", upstreams.length);
  console.log("🔑 DEBRIDS:", stores.map(s => s.c).join(", ") || "Nenhum");

  // ✅ PARALELO CONTROLADO: Máx 3 simultâneos, timeout 20s cada
  const limit = pLimit(3); // npm install p-limit
  
  const promises = upstreams.map((upstream, index) => 
    limit(async () => {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      
      const stremthruUrl = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      
      const shortUrl = upstream.u.slice(-30); // Para log limpo
      
      try {
        const { data } = await axios.get(stremthruUrl, {
          timeout: 20000, // 20s INDIVIDUAL por upstream
          headers: { "User-Agent": "DebridBR/1.0" }
        });
        
        console.log(`✅ ${index + 1}/${upstreams.length} [${shortUrl}] → ${data.streams?.length || 0} streams`);
        return data.streams || [];
        
      } catch (err) {
        if (err.code === 'ECONNABORTED') {
          console.log(`⏰ ${index + 1}/${upstreams.length} [${shortUrl}] → TIMEOUT 20s`);
        } else {
          console.log(`❌ ${index + 1}/${upstreams.length} [${shortUrl}] → ${err.message.slice(0, 30)}`);
        }
        return [];
      }
    })
  );

  // Executa com controle de concorrência
  const results = await Promise.allSettled(promises);
  
  // Agrega streams válidos
  const allStreams = [];
  let successCount = 0;
  
  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.length > 0) {
      allStreams.push(...result.value);
      successCount++;
      console.log(`📈 +${result.value.length} streams (upstream ${index + 1})`);
    }
  });

  console.log(`🎉 FINAL: ${allStreams.length} streams (${successCount}/${upstreams.length} upstreams OK)`);

  const response = { streams: allStreams };

  // Cache seletivo — 30 minutos
  if (allStreams.length > 0) {
    await kv.set(cacheKey, response, { ex: 1800 });
    console.log("💾 CACHE SALVO (30min)");
  } else {
    console.log("⚠️  Sem streams → sem cache");
  }

  return res.json(response);
}

app.get("/:id/stream/:type/:imdb.json", streamHandler);
app.get("/:id/stream/:type/:imdb", streamHandler);

// ===============================
// ROTA DE DEBUG (mantém original)
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

  res.json({ 
    isAnime, 
    upstreamsCount: upstreams.length,
    debrips: stores.map(s => s.c),
    cometManifestUrl: COMET_MANIFEST_URL, 
    stremthruUrl 
  });
});

// ===============================
// SERVE INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

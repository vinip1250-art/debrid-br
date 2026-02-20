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
// HELPERS
// ===============================

/**
 * Gera a URL do manifest do Comet de forma dinâmica,
 * baseada nas configurações do usuário (debrid, idiomas, etc).
 */
function getCometManifest(cfg) {
  const debridServices = [];
  if (cfg.realdebrid) debridServices.push({ id: "realdebrid", apiKey: cfg.realdebrid });
  if (cfg.torbox)     debridServices.push({ id: "torbox",     apiKey: cfg.torbox });
  if (cfg.premiumize) debridServices.push({ id: "premiumize", apiKey: cfg.premiumize });
  if (cfg.debridlink) debridServices.push({ id: "debridlink", apiKey: cfg.debridlink });
  if (cfg.alldebrid)  debridServices.push({ id: "alldebrid",  apiKey: cfg.alldebrid });

  const cometCfg = {
    maxResultsPerResolution: 0,
    maxSize: 0,
    cachedOnly: false,
    sortCachedUncachedTogether: false,
    removeTrash: true,
    resultFormat: ["all"],
    debridServices,
    enableTorrent: true,
    deduplicateStreams: true,
    debridStreamProxyPassword: "",
    languages: {
      required: ["pt"],
      allowed: ["multi", "en", "ja", "zh", "ko"],
      exclude: [
        "multi","en","ja","zh","ru","ar","es","fr","de","it","ko","hi",
        "bn","pa","mr","gu","ta","te","kn","ml","th","vi","id","tr","he",
        "fa","uk","el","lt","lv","et","pl","cs","sk","hu","ro","bg","sr",
        "hr","sl","nl","da","fi","sv","no","ms","la"
      ],
      preferred: ["pt"]
    },
    resolutions: { r576p: false, r480p: false, r360p: false, r240p: false },
    options: {
      remove_ranks_under: -100000000000,
      allow_english_in_languages: false,
      remove_unknown_languages: false
    }
  };

  const encoded = Buffer.from(JSON.stringify(cometCfg)).toString("base64");
  return `https://comet.feels.legal/${encoded}/manifest.json`;
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

  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [];

  // ✅ Brazuca — suporta filmes, séries e animes
  upstreams.push({
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
  });

  // Betor — apenas IDs IMDB (tt), não suporta kitsu
  if (!isAnime) {
    upstreams.push({
      u: "https://betor-scrap.vercel.app/manifest.json"
    });
  }

  // ✅ Comet — manifest gerado dinamicamente com debrid do usuário
  if (cfg.cometa === true) {
    const cometUrl = getCometManifest(cfg);
    upstreams.push({ u: cometUrl });
    console.log("☄️ Comet URL →", cometUrl);
  }

  // Torrentio — suporta kitsu nativamente (nyaasi/tokyotosho/anidex)
  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
  }

  // Serviços de debrid
  const stores = [];
  if (cfg.realdebrid)  stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox)      stores.push({ c: "tb", t: cfg.torbox });
  if (cfg.premiumize)  stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg.debridlink)  stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg.alldebrid)   stores.push({ c: "dl", t: cfg.alldebrid });

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
    console.log("ERRO NO STREMTHRU:", err.message);
    return res.json({ streams: [] });
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

  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [];

  upstreams.push({ u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" });

  if (!isAnime) {
    upstreams.push({ u: "https://betor-scrap.vercel.app/manifest.json" });
  }

  if (cfg.cometa === true) {
    upstreams.push({ u: getCometManifest(cfg) });
  }

  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,nekobt,comando,bludv,micoleaodublado|language=portuguese/manifest.json"
    });
  }

  const stores = [];
  if (cfg.realdebrid)  stores.push({ c: "rd", t: cfg.realdebrid });
  if (cfg.torbox)      stores.push({ c: "tb", t: cfg.torbox });
  if (cfg.premiumize)  stores.push({ c: "pm", t: cfg.premiumize });
  if (cfg.debridlink)  stores.push({ c: "dl", t: cfg.debridlink });
  if (cfg.alldebrid)   stores.push({ c: "dl", t: cfg.alldebrid });

  const wrapper = { upstreams, stores };
  const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");

  const stremthruUrl =
    `https://stremthru.13377001.xyz/stremio/wrap/${encoded}` +
    `/stream/${type}/${imdb}.json`;

  res.json({ isAnime, cometUrl: cfg.cometa ? getCometManifest(cfg) : null, wrapper, stremthruUrl });
});

// ===============================
// SERVE INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

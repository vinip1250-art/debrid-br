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

const COMET_MANIFEST_URL = getCometManifest();

// ===============================
// FUNÇÃO AUXILIAR (DRY)
// ===============================
function buildUpstreamsAndStores(cfg, imdb) {
  const isAnime = imdb.startsWith("kitsu:");
  const upstreams = [];

  upstreams.push({
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
  });

  if (!isAnime) {
    upstreams.push({
      u: "https://betor-scrap.vercel.app/manifest.json"
    });
    upstreams.push({
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json"
    });
  }

  if (cfg.cometa === true) {
    upstreams.push({ u: COMET_MANIFEST_URL });
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
  if (cfg.alldebrid)   stores.push({ c: "ad", t: cfg.alldebrid });

  return { isAnime, upstreams, stores };
}

// ===============================
// ROTA GERAR
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("🧩 CFG criada:", id);
  res.json({ id });
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
      version: "3.9.0",
      name: cfg.nome || "BRDebrid",
      description: "Brazuca + Betor + Torrentio + Comet",
      logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",
      types: ["movie", "series", "anime"],
      resources: [{
        name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt", "kitsu"]
      }],
      catalogs: [],
      behaviorHints: {
        configurable: true,
        configurationRequired: false
      }
    });
  } catch (err) {
    console.error("Manifest error:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===============================
// STREAM COM RESPOSTA RÁPIDA + CACHE EM BACKGROUND
// ===============================
app.get("/:id/stream/:type/:imdb.json", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    console.log("🎬 Request:", type, imdb);

    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) {
      console.log("❌ CFG não encontrada");
      return res.json({ streams: [] });
    }

    const cacheKey = `cache:${id}:${type}:${imdb}`;

    // ✅ CACHE HIT — retorna instantaneamente com todos os resultados
    const cached = await kv.get(cacheKey);
    if (cached) {
      console.log("💾 CACHE HIT — resposta instantânea");
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log("📡 Upstreams:", upstreams.length, "Debrids:", stores.length);

    // ===============================
    // HELPER: busca um único upstream
    // ===============================
    const fetchUpstream = async (upstream, index, timeoutMs = 20000) => {
      const wrapper = { upstreams: [upstream], stores };
      const encoded = Buffer.from(JSON.stringify(wrapper)).toString("base64");
      const url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;

      const { data } = await axios.get(url, {
        timeout: timeoutMs,
        headers: { "User-Agent": "DebridBR/1.0" }
      });

      const streams = data.streams || [];
      console.log(`✅ Upstream ${index + 1}: ${streams.length} streams`);
      return streams;
    };

    // ===============================
    // ESTÁGIO 1: Race — responde com o primeiro que chegar
    // com pelo menos 1 stream, ou aguarda até FAST_TIMEOUT ms
    // ===============================
    const FAST_TIMEOUT = 10000; // 10s para aguardar o primeiro resultado

    const fastResult = await Promise.race([
      // Tenta cada upstream e resolve assim que o primeiro retornar streams
      (async () => {
        const settled = await Promise.race(
          upstreams.map((upstream, i) =>
            fetchUpstream(upstream, i)
              .then(streams => (streams.length > 0 ? streams : new Promise(() => {}))) // ignora vazios
              .catch(() => new Promise(() => {})) // ignora erros
          )
        );
        return settled;
      })(),

      // Fallback: se nenhum responder rápido, retorna vazio após FAST_TIMEOUT
      new Promise(resolve => setTimeout(() => resolve([]), FAST_TIMEOUT))
    ]);

    // Responde ao cliente com o resultado rápido
    console.log(`⚡ Resposta rápida: ${fastResult.length} streams`);
    res.json({ streams: fastResult });

    // ===============================
    // ESTÁGIO 2: Background — busca TODOS e salva no cache
    // ===============================
    const backgroundFetch = async () => {
      try {
        console.log("🔄 Background: buscando todos os upstreams...");

        const promises = upstreams.map((upstream, i) =>
          fetchUpstream(upstream, i, 50000).catch(err => {
            console.log(`⏰ Upstream ${i + 1} background: ERRO — ${err.message}`);
            return [];
          })
        );

        const results = await Promise.allSettled(promises);
        const allStreams = results
          .filter(r => r.status === "fulfilled")
          .flatMap(r => r.value)
          .filter(Boolean);

        console.log(`📊 Background TOTAL: ${allStreams.length} streams`);

        if (allStreams.length > 0) {
          await kv.set(cacheKey, { streams: allStreams }, { ex: 1800 });
          console.log("💾 Cache completo salvo — próxima busca será instantânea");
        }
      } catch (err) {
        console.error("🚨 Erro no background fetch:", err.message);
      }
    };

    // Dispara em background SEM await — não bloqueia a resposta
    backgroundFetch();

  } catch (err) {
    console.error("🚨 ERRO 500:", err.message);
    res.status(500).json({ streams: [], error: "Erro interno" });
  }
});

app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

// ===============================
// DEBUG SIMPLES
// ===============================
app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  const { id, type, imdb } = req.params;
  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) return res.json({ error: "CFG não encontrada" });

  const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
  res.json({ 
    upstreams: upstreams.length, 
    stores: stores.map(s => s.c),
    imdb 
  });
});

// ===============================
// INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

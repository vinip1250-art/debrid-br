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
// HELPERS DE ENCODING
// ===============================
function toB64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function toB64Raw(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

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
  return `https://comet.feels.legal/${toB64(cometCfg)}/manifest.json`;
}

const COMET_MANIFEST_URL = getCometManifest();

// ===============================
// TORZ (DUBLADO) — gerado dinamicamente
// Usa /stremio/torz/ com filtro de nomes PT-BR.
// Por ser um scraper com filtro, pode demorar mais —
// tratado igual ao dfaddon: participa da janela rápida
// e é incluído no background com timeout estendido.
// ===============================
function getTorzManifest() {
  const torzCfg = {
    stores: [{ c: "p2p", t: "" }],
    filter:
      "File.Name matches '(?i)(dublado|dual.5|dual.2|nacional|brazilian|pt-br|ptbr|brasil|brazil|sf|bioma|c76|c0ral|sigma|andrehsa|riper|sigla|eck)'"
  };
  return `https://stremthru.13377001.xyz/stremio/torz/${toB64Raw(torzCfg)}/manifest.json`;
}

const TORZ_MANIFEST_URL = getTorzManifest();

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
    // Torz: scraper P2P com filtro PT-BR — comportamento similar ao dfaddon
    upstreams.push({
      u: TORZ_MANIFEST_URL,
      isTorz: true // flag para usar URL diferente no fetchUpstream
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
    // Torz usa /stremio/torz/<config_b64>/stream/...
    // Os demais usam /stremio/wrap/<wrapper_b64>/stream/...
    // ===============================
    const fetchUpstream = async (upstream, index, timeoutMs = 20000) => {
      let url;

      if (upstream.isTorz) {
        // Torz: a URL do manifest já contém o config encoded,
        // basta substituir /manifest.json pelo path de stream
        const base = upstream.u.replace("/manifest.json", "");
        url = `${base}/stream/${type}/${imdb}.json`;
      } else {
        const wrapper = { upstreams: [{ u: upstream.u }], stores };
        const encoded = toB64(wrapper);
        url = `https://stremthru.13377001.xyz/stremio/wrap/${encoded}/stream/${type}/${imdb}.json`;
      }

      const { data } = await axios.get(url, {
        timeout: timeoutMs,
        headers: { "User-Agent": "DebridBR/1.0" }
      });

      const streams = data.streams || [];
      console.log(`✅ Upstream ${index + 1}${upstream.isTorz ? " [Torz]" : ""}: ${streams.length} streams`);
      return streams;
    };

    // ===============================
    // ESTÁGIO 1: Janela de 10s — acumula todos os upstreams
    // que responderem dentro do prazo. Upstreams que não
    // responderem a tempo são descartados desta resposta,
    // mas ainda serão buscados no background (50s).
    // ===============================
    const FAST_TIMEOUT = 10000; // janela de 10s para acumular resultados

    const fastResult = await new Promise(resolve => {
      const accumulated = [];
      let finished = 0;
      const total = upstreams.length;

      // Timer que fecha a janela e resolve com o que foi acumulado
      const timer = setTimeout(() => {
        console.log(`⏱️ Janela rápida encerrada — ${accumulated.length} streams acumulados de ${finished}/${total} upstreams`);
        resolve([...accumulated]);
      }, FAST_TIMEOUT);

      upstreams.forEach((upstream, i) => {
        fetchUpstream(upstream, i, 20000)
          .then(streams => {
            accumulated.push(...streams);
            console.log(`➕ Upstream ${i + 1} chegou a tempo: ${streams.length} streams (acumulado: ${accumulated.length})`);
          })
          .catch(err => {
            console.log(`⏰ Upstream ${i + 1} não chegou a tempo: ${err.message}`);
          })
          .finally(() => {
            finished++;
            // Se todos responderam antes do timeout, resolve imediatamente
            if (finished === total) {
              clearTimeout(timer);
              console.log(`✅ Todos upstreams responderam antes da janela: ${accumulated.length} streams`);
              resolve([...accumulated]);
            }
          });
      });
    });

    // Responde ao cliente com tudo que chegou dentro da janela
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
    upstreams: upstreams.map((u, i) => ({ index: i + 1, url: u.u, isTorz: !!u.isTorz })),
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

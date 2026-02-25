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

// URL-safe base64 sem padding — necessário para URLs do Torz
function toB64Raw(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ===============================
// COMET — gerado dinamicamente (sem tokens, ok ser global)
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
// TORZ — gerado por request com os stores do usuário
// O Torz embute tudo no config da URL (stores + filter),
// diferente do wrap que recebe stores separadamente.
// ===============================
function getTorzUrl(stores, type, imdb) {
  const torzCfg = {
    stores,
    filter:
      "File.Name matches '(?i)(dublado|dual.5|dual.2|nacional|brazilian|pt-br|ptbr|brasil|brazil|sf|bioma|c76|c0ral|sigma|andrehsa|riper|sigla|eck)'"
  };
  return `https://stremthru.13377001.xyz/stremio/torz/${toB64Raw(torzCfg)}/stream/${type}/${imdb}.json`;
}

// ===============================
// FUNÇÃO AUXILIAR (DRY)
// ===============================
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
      name: "DFIndexer",
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyIzIiwiOCJdLCJtYXhfcmVzdWx0cyI6IjUifQ/manifest.json"
    });
    // Torz: isTorz=true — URL de stream gerada dinamicamente com stores
    upstreams.push({
      name: "Torz",
      isTorz: true
    });
  }

  if (cfg.cometa === true) {
    upstreams.push({ name: "Comet", u: COMET_MANIFEST_URL });
  }

  if (cfg.torrentio === true) {
    upstreams.push({
      name: "Torrentio",
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
    console.log(`\n🎬 Request: ${type} ${imdb}`);

    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) {
      console.log("❌ CFG não encontrada");
      return res.json({ streams: [] });
    }

    const cacheKey = `cache:${id}:${type}:${imdb}`;

    // CACHE HIT — retorna instantaneamente com todos os resultados
    const cached = await kv.get(cacheKey);
    if (cached) {
      console.log(`💾 CACHE HIT — ${cached.streams?.length || 0} streams instantâneos`);
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log(`📡 Upstreams: ${upstreams.map(u => u.name).join(", ")}`);
    console.log(`💳 Debrids: ${stores.length > 0 ? stores.map(s => s.c.toUpperCase()).join(", ") : "nenhum"}`);

    // ===============================
    // HELPER: busca um upstream com timeout próprio
    // Retorna [] em caso de erro — nunca lança exceção
    // Torz  → URL gerada dinamicamente com stores do usuário embutidos
    // Demais → /stremio/wrap/<base64>/stream/...
    // ===============================
    const fetchUpstream = async (upstream, timeoutMs) => {
      let url;

      if (upstream.isTorz) {
        url = getTorzUrl(stores, type, imdb);
      } else {
        const wrapper = { upstreams: [{ u: upstream.u }], stores };
        url = `https://stremthru.13377001.xyz/stremio/wrap/${toB64(wrapper)}/stream/${type}/${imdb}.json`;
      }

      try {
        const { data } = await axios.get(url, {
          timeout: timeoutMs,
          headers: { "User-Agent": "DebridBR/1.0" }
        });
        return data.streams || [];
      } catch (err) {
        if (err.response) {
          console.log(`🔍 [${upstream.name}] HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`);
          console.log(`🔍 [${upstream.name}] URL: ${url}`);
        }
        // Sempre retorna [] — nunca bloqueia os outros
        return [];
      }
    };

    // ===============================
    // ESTÁGIO 1: cada upstream tem seu próprio timeout de 9s.
    // A janela global de 10s é apenas um safety net.
    // Todos rodam em paralelo e independentemente —
    // erro ou timeout de um nunca afeta os demais.
    // ===============================
    const FAST_TIMEOUT   = 10000; // safety net global
    const FAST_PER_ADDON =  9000; // timeout individual por addon

    const fastResult = await new Promise(resolve => {
      const accumulated = [];
      let finished = 0;
      const total = upstreams.length;
      let resolved = false;

      const tryResolve = (reason) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(globalTimer);
        console.log(`⏱️  Janela encerrada [${reason}] — ${accumulated.length} streams de ${finished}/${total} upstreams`);
        resolve([...accumulated]);
      };

      // Safety net: encerra tudo após 10s no máximo
      const globalTimer = setTimeout(() => tryResolve("timeout global 10s"), FAST_TIMEOUT);

      upstreams.forEach((upstream) => {
        // Cada addon tem 9s independente — erro/timeout não bloqueia os outros
        fetchUpstream(upstream, FAST_PER_ADDON)
          .then(streams => {
            if (streams.length > 0) {
              accumulated.push(...streams);
              console.log(`✅ [${upstream.name}] ${streams.length} streams (acumulado: ${accumulated.length})`);
            } else {
              console.log(`⚪ [${upstream.name}] 0 streams`);
            }
          })
          .finally(() => {
            finished++;
            if (finished === total) {
              tryResolve("todos concluídos");
            }
          });
      });
    });

    console.log(`⚡ Resposta rápida: ${fastResult.length} streams`);
    res.json({ streams: fastResult });

    // ===============================
    // ESTÁGIO 2: Background — busca TODOS com 50s e salva cache
    // ===============================
    const backgroundFetch = async () => {
      try {
        console.log(`\n🔄 [Background] iniciando para ${imdb}...`);

        const results = await Promise.allSettled(
          upstreams.map(upstream =>
            fetchUpstream(upstream, 50000)
              .then(streams => {
                if (streams.length > 0) {
                  console.log(`✅ [Background][${upstream.name}] ${streams.length} streams`);
                } else {
                  console.log(`⚪ [Background][${upstream.name}] 0 streams`);
                }
                return streams;
              })
          )
        );

        const allStreams = results
          .filter(r => r.status === "fulfilled")
          .flatMap(r => r.value)
          .filter(Boolean);

        console.log(`📊 [Background] TOTAL: ${allStreams.length} streams`);

        if (allStreams.length > 0) {
          await kv.set(cacheKey, { streams: allStreams }, { ex: 1800 });
          console.log(`💾 [Background] cache salvo — próxima busca será instantânea`);
        }
      } catch (err) {
        console.error(`🚨 [Background] erro: ${err.message}`);
      }
    };

    // Dispara em background SEM await
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
  const torzUrl = getTorzUrl(stores, type, imdb);

  res.json({
    upstreams: upstreams.map((u, i) => ({
      index: i + 1,
      name: u.name,
      isTorz: !!u.isTorz,
      url: u.isTorz ? torzUrl : u.u
    })),
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

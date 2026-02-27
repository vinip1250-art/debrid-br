const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Redis } = require("@upstash/redis");

const app = express();
app.use(cors());
app.use(express.json());

// ===============================
// CONFIGURAÃ‡ÃƒO DO REDIS
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
// DEDUPLICAÃ‡ÃƒO DE STREAMS
// Remove streams duplicados entre addons usando infoHash ou url como chave.
// ===============================
function dedupeStreams(streams) {
  if (!Array.isArray(streams)) return [];

  const seen = new Set();
  const result = [];

  for (const s of streams) {
    const key =
      s.infoHash ||
      s.url ||
      (s.title && s.behaviorHints?.filename
        ? `${s.title}|${s.behaviorHints.filename}`
        : null);

    if (!key) {
      result.push(s);
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(s);
  }

  return result;
}

// ===============================
// COMET â€” gerado dinamicamente
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
// TORZ â€” gerado por request com os stores do usuÃ¡rio
// ===============================
function getTorzUrl(stores, type, imdb) {
  const torzCfg = {
    stores,
    filter:
      "File.Name matches '(?i)(dublado|dual.5|dual.2|nacional|brazilian|pt-br|ptbr|brasil|brazil|brremux|cza|freddiegellar|sgf|asc|dual-bioma|dual-c76|fly|tossato|7sprit7|c.a.a|c0ral|cbr|dual-nogroup|pia|xor|g4ris|sigma|andrehsa|riper|sigla|tontom|eck)'"
  };
  return `https://stremthru.13377001.xyz/stremio/torz/${toB64Raw(torzCfg)}/stream/${type}/${imdb}.json`;
}

// ===============================
// FUNÃ‡ÃƒO AUXILIAR (DRY)
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
      u: "https://dfaddon.vercel.app/eyJzY3JhcGVycyI6WyI4Il0sIm1heF9yZXN1bHRzIjoiNSJ9/manifest.json"
    });
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
  if (cfg.offcloud)    stores.push({ c: "oc", t: cfg.offcloud }); // âœ… Offcloud

  return { isAnime, upstreams, stores };
}

// ===============================
// ROTA GERAR
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  console.log("ðŸ§© CFG criada:", id);
  res.json({ id });
});

// ===============================
// MANIFEST
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  try {
    const cfg = await kv.get(`addon:${req.params.id}`);
    if (!cfg) return res.status(404).json({ error: "Manifest nÃ£o encontrado" });

    res.json({
      id: `brazuca-debrid-${req.params.id}`,
      version: "4.2.0",
      name: cfg.nome || "BRDebrid",
      description: "Brazuca + Betor + DFIndexer + Torz + Comet + Torrentio",
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
// STREAM COM RESPOSTA RÃPIDA + CACHE EM BACKGROUND
// ===============================
app.get("/:id/stream/:type/:imdb.json", async (req, res) => {
  try {
    const { id, type, imdb } = req.params;
    console.log(`\nðŸŽ¬ Request: ${type} ${imdb}`);

    const cfg = await kv.get(`addon:${id}`);
    if (!cfg) {
      console.log("âŒ CFG nÃ£o encontrada");
      return res.json({ streams: [] });
    }

    const cacheKey = `cache:${id}:${type}:${imdb}`;

    const cached = await kv.get(cacheKey);
    if (cached) {
      console.log(`ðŸ’¾ CACHE HIT â€” ${cached.streams?.length || 0} streams instantÃ¢neos`);
      return res.json(cached);
    }

    const { upstreams, stores } = buildUpstreamsAndStores(cfg, imdb);
    console.log(`ðŸ“¡ Upstreams: ${upstreams.map(u => u.name).join(", ")}`);
    console.log(`ðŸ’³ Debrids: ${stores.length > 0 ? stores.map(s => s.c.toUpperCase()).join(", ") : "nenhum"}`);

    // ===============================
    // HELPER: busca um upstream com timeout prÃ³prio
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
          console.log(`ðŸ” [${upstream.name}] HTTP ${err.response.status} â€” ${JSON.stringify(err.response.data)}`);
          console.log(`ðŸ” [${upstream.name}] URL: ${url}`);
        }
        return [];
      }
    };

    // ===============================
    // ESTÃGIO 1: Resposta rÃ¡pida (todos paralelos, 13s max)
    // ===============================
    const FAST_TIMEOUT   = 13000;
    const FAST_PER_ADDON = 12000;

    const fastResult = await new Promise(resolve => {
      const accumulated = [];
      let finished = 0;
      const total = upstreams.length;
      let resolved = false;

      const tryResolve = (reason) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(globalTimer);
        console.log(`â±ï¸  Janela encerrada [${reason}] â€” ${accumulated.length} streams de ${finished}/${total} upstreams`);
        resolve([...accumulated]);
      };

      const globalTimer = setTimeout(() => tryResolve("timeout global 13s"), FAST_TIMEOUT);

      upstreams.forEach((upstream) => {
        fetchUpstream(upstream, FAST_PER_ADDON)
          .then(streams => {
            if (streams.length > 0) {
              accumulated.push(...streams);
              console.log(`âœ… [${upstream.name}] ${streams.length} streams (acumulado: ${accumulated.length})`);
            } else {
              console.log(`âšª [${upstream.name}] 0 streams`);
            }
          })
          .finally(() => {
            finished++;
            if (finished === total) tryResolve("todos concluÃ­dos");
          });
      });
    });

    // âœ… DeduplicaÃ§Ã£o na resposta rÃ¡pida
    const fastDeduped = dedupeStreams(fastResult);
    console.log(`âš¡ Resposta rÃ¡pida: ${fastResult.length} streams â†’ ${fastDeduped.length} apÃ³s dedup`);

    res.json({ streams: fastDeduped });

    // ===============================
    // ESTÃGIO 2: Background â€” salva cache completo com dedup
    // ===============================
    const backgroundFetch = async () => {
      try {
        console.log(`\nðŸ”„ [Background] iniciando para ${imdb}...`);

        const results = await Promise.allSettled(
          upstreams.map(upstream =>
            fetchUpstream(upstream, 50000)
              .then(streams => {
                if (streams.length > 0) {
                  console.log(`âœ… [Background][${upstream.name}] ${streams.length} streams`);
                } else {
                  console.log(`âšª [Background][${upstream.name}] 0 streams`);
                }
                return streams;
              })
          )
        );

        const allStreams = results
          .filter(r => r.status === "fulfilled")
          .flatMap(r => r.value)
          .filter(Boolean);

        // âœ… DeduplicaÃ§Ã£o no cache background
        const allDeduped = dedupeStreams(allStreams);
        console.log(`ðŸ“Š [Background] ${allStreams.length} streams â†’ ${allDeduped.length} apÃ³s dedup`);

        if (allDeduped.length > 0) {
          await kv.set(cacheKey, { streams: allDeduped }, { ex: 1800 });
          console.log(`ðŸ’¾ [Background] cache salvo â€” prÃ³xima busca serÃ¡ instantÃ¢nea`);
        }
      } catch (err) {
        console.error(`ðŸš¨ [Background] erro: ${err.message}`);
      }
    };

    backgroundFetch();

  } catch (err) {
    console.error("ðŸš¨ ERRO 500:", err.message);
    res.status(500).json({ streams: [], error: "Erro interno" });
  }
});

app.get("/:id/stream/:type/:imdb", (req, res) => {
  res.redirect(`/${req.params.id}/stream/${req.params.type}/${req.params.imdb}.json`);
});

// ===============================
// DEBUG
// ===============================
app.get("/debug-stream/:id/:type/:imdb", async (req, res) => {
  const { id, type, imdb } = req.params;
  const cfg = await kv.get(`addon:${id}`);
  if (!cfg) return res.json({ error: "CFG nÃ£o encontrada" });

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

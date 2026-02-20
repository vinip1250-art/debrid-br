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
// ROTA PARA GERAR CONFIGURAÇÃO
// ===============================
app.post("/gerar", async (req, res) => {
  const id = Math.random().toString(36).substring(2, 10);
  await kv.set(`addon:${id}`, req.body);
  res.json({ id });
});

// ===============================
// MANIFEST STREAM‑ONLY (SEM CATÁLOGO)
// ===============================
app.get("/:id/manifest.json", async (req, res) => {
  const cfg = await kv.get(`addon:${req.params.id}`);
  if (!cfg) return res.status(404).json({ error: "Manifest não encontrado" });

  res.json({
    id: `brazuca-debrid-${req.params.id}`,
    version: "3.7.0",
    name: cfg.nome || "BRDebrid",
    description: "Brazuca + Betor + Torrentio + Comet",
    logo: cfg.icone || "https://brazuca-debrid.vercel.app/logo.png",

    // ✅ Anime adicionado
    types: ["movie", "series", "anime"],

    resources: [
      {
        name: "stream",
        types: ["movie", "series", "anime"],
        // tt = IMDB (filmes/séries), kitsu = IDs de anime
        idPrefixes: ["tt", "kitsu"]
      }
    ],

    catalogs: [] // catálogo removido
  });
});

// ===============================
// STREAM (com cache seletivo + logs)
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

  const upstreams = [];

  // Brazuca Torrents
  upstreams.push({
    u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json"
  });

  // Betor
  upstreams.push({
    u: "https://betor-scrap.vercel.app/manifest.json"
  });

  // Comet
  if (cfg.cometa === true) {
    upstreams.push({
      u: "https://comet.feels.legal/eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6MCwibWF4U2l6ZSI6MCwiY2FjaGVkT25seSI6ZmFsc2UsInNvcnRDYWNoZWRVbmNhY2hlZFRvZ2V0aGVyIjpmYWxzZSwicmVtb3ZlVHJhc2giOnRydWUsInJlc3VsdEZvcm1hdCI6WyJhbGwiXSwiZGVicmlkU2VydmljZXMiOltdLCJlbmFibGVUb3JyZW50Ijp0cnVlLCJkZWR1cGxpY2F0ZVN0cmVhbXMiOnRydWUsImRlYnJpZFN0cmVhbVByb3h5UGFzc3dvcmQiOiIiLCJsYW5ndWFnZXMiOnsicmVxdWlyZWQiOlsicHQiXSwiYWxsb3dlZCI6WyJtdWx0aSIsImVuIiwiamEiLCJ6aCIsImtvIl0sImV4Y2x1ZGUiOlsibXVsdGkiLCJlbiIsImphIiwiemgiLCJydSIsImFyIiwiZXMiLCJmciIsImRlIiwiaXQiLCJrbyIsImhpIiwiYm4iLCJwYSIsIm1yIiwiZ3UiLCJ0YSIsInRlIiwia24iLCJtbCIsInRoIiwidmkiLCJpZCIsInRyIiwiaGUiLCJmYSIsInVrIiwiZWwiLCJsdCIsImx2IiwiZXQiLCJwbCIsImNzIiwic2siLCJodSIsInJvIiwiYmciLCJzciIsImhyIiwic2wiLCJubCIsImRhIiwiZmkiLCJzdiIsIm5vIiwibXMiLCJsYSJdLCJwcmVmZXJyZWQiOlsicHQiXX0sInJlc29sdXRpb25zIjp7InI1NzZwIjpmYWxzZSwicjQ4MHAiOmZhbHNlLCJyMzYwcCI6ZmFsc2UsInIyNDBwIjpmYWxzZX0sIm9wdGlvbnMiOnsicmVtb3ZlX3JhbmtzX3VuZGVyIjotMTAwMDAwMDAwMDAsImFsbG93X2VuZ2xpc2hfaW5fbGFuZ3VhZ2VzIjpmYWxzZSwicmVtb3ZlX3Vua25vd25fbGFuZ3VhZ2VzIjpmYWxzZX19/manifest.json"
    });
  }

  // Torrentio
  // ✅ Já inclui nyaasi, tokyotosho e anidex — principais fontes de anime
  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado|language=portuguese|qualityfilter=480p,scr,cam/manifest.json"
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

    // Cache seletivo — ✅ 30 minutos (1800 segundos)
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

  const upstreams = [];

  upstreams.push({ u: "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json" });

  if (cfg.cometa === true) {
    upstreams.push({ u: "https://comet.feels.legal/..." });
  }

  if (cfg.torrentio === true) {
    upstreams.push({
      u: "https://torrentio.strem.fun/providers=nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado|language=portuguese|qualityfilter=480p,scr,cam/manifest.json"
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

  res.json({ wrapper, stremthruUrl });
});

// ===============================
// SERVE INDEX
// ===============================
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

module.exports = app;

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');

const app = express();
app.use(cors());

// ============================================================
// 1. MANIFESTO (Nome Limpo: "Brazuca")
// ============================================================
const manifest = {
    id: 'community.brazuca.pro.direct',
    version: '5.0.0',
    name: 'Brazuca', // Nome limpo como solicitado
    description: 'Filmes e Séries Brasileiros (Real-Debrid & TorBox)',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    logo: "https://i.imgur.com/Q61eP9V.png"
};

const builder = new addonBuilder(manifest);
const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";
// Vídeo curto para evitar erro ao iniciar download
const DOWNLOAD_NOTIFY_VIDEO = "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4"; 

const TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.openbittorrent.com:80/announce"
];

// ============================================================
// 2. FUNÇÕES DE DEBRID (Refinadas)
// ============================================================

// --- REAL-DEBRID ---
async function resolveRealDebrid(infoHash, apiKey) {
    try {
        let magnet = `magnet:?xt=urn:btih:${infoHash}`;
        
        // 1. Adicionar
        const addUrl = 'https://api.real-debrid.com/rest/1.0/torrents/addMagnet';
        const addResp = await axios.post(addUrl, `magnet=${encodeURIComponent(magnet)}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        const torrentId = addResp.data.id;

        // 2. Selecionar (Wait Loop)
        const infoUrl = `https://api.real-debrid.com/rest/1.0/torrents/info/${torrentId}`;
        let attempts = 0;
        while (attempts < 5) {
            const infoResp = await axios.get(infoUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            if (infoResp.data.status === 'waiting_files_selection') {
                await axios.post(`https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${torrentId}`, `files=all`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
            attempts++;
        }

        // 3. Pegar Link
        const finalInfo = await axios.get(infoUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (finalInfo.data.links && finalInfo.data.links.length > 0) {
            const unrestrictResp = await axios.post('https://api.real-debrid.com/rest/1.0/unrestrict/link', `link=${finalInfo.data.links[0]}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            return unrestrictResp.data.download;
        }
        return null; // Download started
    } catch (e) { return null; }
}

async function checkRealDebridCache(hashes, apiKey) {
    if (!hashes.length) return {};
    const validHashes = hashes.slice(0, 50);
    try {
        const url = `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${validHashes.join('/')}`;
        const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const results = {};
        
        for (const h of validHashes) {
            // Busca case-insensitive
            const key = Object.keys(resp.data).find(k => k.toLowerCase() === h.toLowerCase());
            const data = key ? resp.data[key] : null;
            
            if (data && data.rd && Array.isArray(data.rd) && data.rd.length > 0) {
                results[h] = true;
            } else {
                results[h] = false;
            }
        }
        return results;
    } catch (e) { return {}; }
}

// --- TORBOX (Fix API v1) ---
async function resolveTorBox(infoHash, apiKey) {
    try {
        // Magnet Limpo (Sem trackers para evitar erro de parser do TorBox)
        const magnet = `magnet:?xt=urn:btih:${infoHash}`;
        
        // 1. Create
        const createUrl = 'https://api.torbox.app/v1/api/torrents/create';
        // TorBox prefere x-www-form-urlencoded ou multipart
        const params = new URLSearchParams();
        params.append('magnet', magnet);
        params.append('seed', '1');
        
        const createResp = await axios.post(createUrl, params, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });
        
        const torrentId = createResp.data.data.torrent_id;
        
        // 2. Get Link (Retry logic)
        await new Promise(r => setTimeout(r, 1000)); // Delay inicial
        
        const listUrl = `https://api.torbox.app/v1/api/torrents/mylist?bypass_cache=true&id=${torrentId}`;
        const listResp = await axios.get(listUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const data = listResp.data.data;
        
        if (data && data.files && data.files.length > 0) {
            // Pega o maior arquivo
            const file = data.files.reduce((prev, curr) => (prev.size > curr.size) ? prev : curr);
            
            const reqUrl = `https://api.torbox.app/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${file.id}&zip_link=false`;
            const reqResp = await axios.get(reqUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            
            if (reqResp.data.success) return reqResp.data.data;
        }
        return null; // Download started
    } catch (e) { 
        console.error("Torbox Error:", e.message);
        return null; 
    }
}

async function checkTorBoxCache(hashes, apiKey) {
    if (!hashes.length) return {};
    const hStr = hashes.slice(0, 40).join(',');
    try {
        const url = `https://api.torbox.app/v1/api/torrents/checkcached?hash=${hStr}&format=list&list_files=false`;
        const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        const results = {};
        hashes.forEach(h => results[h] = false);
        
        const data = resp.data.data; // Lista de hashes encontrados
        if (Array.isArray(data)) {
            data.forEach(h => { if(h) results[h.toLowerCase()] = true; });
        } else if (typeof data === 'object') {
            Object.keys(data).forEach(k => { if(data[k]) results[k.toLowerCase()] = true; });
        }
        return results;
    } catch (e) { return {}; }
}

// ============================================================
// 3. HTML CONFIG
// ============================================================
const configureHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Config</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>body{background:#050505;color:#fff}.sel{border:2px solid #3b82f6;background:#1a1a1a}</style>
</head>
<body class="flex items-center justify-center min-h-screen p-4">
    <div class="w-full max-w-md bg-gray-900 rounded-xl p-6 border border-gray-800 shadow-2xl">
        <div class="text-center mb-6">
            <h1 class="text-2xl font-bold text-blue-500">BRAZUCA</h1>
            <p class="text-xs text-gray-500">Configuração Direta</p>
        </div>
        
        <div class="space-y-4">
            <div>
                <label class="text-xs font-bold text-gray-400 uppercase">Serviço</label>
                <div class="grid grid-cols-2 gap-3 mt-1">
                    <button onclick="setSvc('realdebrid')" id="btn-realdebrid" class="p-3 rounded border border-gray-700 hover:bg-gray-800 text-sm transition">🌍 Real-Debrid</button>
                    <button onclick="setSvc('torbox')" id="btn-torbox" class="p-3 rounded border border-gray-700 hover:bg-gray-800 text-sm transition">🟣 TorBox</button>
                </div>
            </div>

            <div>
                <label class="text-xs font-bold text-gray-400 uppercase">API Key</label>
                <input id="key" type="text" placeholder="Cole sua chave..." class="w-full p-3 mt-1 bg-black border border-gray-700 rounded text-sm focus:border-blue-500 outline-none">
            </div>

            <a id="install" href="#" class="block w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded text-center mt-4 opacity-50 pointer-events-none transition">
                INSTALAR
            </a>
        </div>
    </div>
    <script>
        let cfg = { s: '', k: '' };
        function setSvc(s) {
            cfg.s = s;
            document.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
            document.getElementById('btn-'+s).classList.add('sel');
            upd();
        }
        function upd() {
            cfg.k = document.getElementById('key').value.trim();
            const btn = document.getElementById('install');
            if(cfg.s && cfg.k) {
                btn.classList.remove('opacity-50', 'pointer-events-none');
                const b64 = btoa(JSON.stringify(cfg));
                btn.href = 'stremio://' + window.location.host + '/' + encodeURIComponent(b64) + '/manifest.json';
            } else {
                btn.classList.add('opacity-50', 'pointer-events-none');
            }
        }
        document.getElementById('key').addEventListener('input', upd);
    </script>
</body>
</html>
`;

// ============================================================
// 4. ROTAS
// ============================================================

app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => res.send(configureHtml));

app.get('/:config/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const m = { ...manifest };
    try { if(req.params.config.length > 5) m.behaviorHints = { configurable: true, configurationRequired: false }; } catch(e){}
    res.json(m);
});

// STREAM HANDLER
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    let cfg;
    try { cfg = JSON.parse(Buffer.from(decodeURIComponent(req.params.config), 'base64').toString()); } 
    catch(e) { return res.json({ streams: [] }); }

    if (!cfg.k) return res.json({ streams: [{ title: '⚠ Configure o Addon' }] });

    // 1. Buscar no Brazuca
    let streams = [];
    try {
        const resp = await axios.get(`${BRAZUCA_UPSTREAM}/stream/${req.params.type}/${req.params.id}.json`, { timeout: 6000 });
        streams = resp.data.streams || [];
    } catch(e) { return res.json({ streams: [] }); }

    if (!streams.length) return res.json({ streams: [] });

    // 2. Verificar Cache
    const hashList = [];
    streams.forEach(s => {
        let h = s.infoHash;
        if (!h && s.url && s.url.startsWith('magnet:')) {
            const m = s.url.match(/xt=urn:btih:([a-zA-Z0-9]{40})/);
            if (m) h = m[1];
        }
        if (h) { s.infoHash = h.toLowerCase(); if(!hashList.includes(s.infoHash)) hashList.push(s.infoHash); }
    });

    let cache = {};
    if (hashList.length > 0) {
        if (cfg.s === 'realdebrid') cache = await checkRealDebridCache(hashList, cfg.k);
        else if (cfg.s === 'torbox') cache = await checkTorBoxCache(hashList, cfg.k);
    }

    // 3. Gerar Resposta
    const finalStreams = streams.map(s => {
        const h = s.infoHash;
        if (!h) return null;

        const isCached = cache[h] === true;
        const icon = isCached ? '⚡' : '📥';
        const state = isCached ? 'INSTANT' : 'DOWNLOAD (Cloud)';
        const cleanTitle = (s.title || 'video').replace(/\n/g, ' ').replace(/\[.*?\]/g, '').trim();

        const resolveUrl = `${req.protocol}://${req.get('host')}/resolve/${encodeURIComponent(cfg.s)}/${encodeURIComponent(cfg.k)}/${h}`;

        return {
            name: `BR ${cfg.s === 'realdebrid' ? 'RD' : 'TB'}`,
            title: `${icon} ${cleanTitle}\n${state}`,
            url: resolveUrl,
            behaviorHints: { notWebReady: !isCached }
        };
    }).filter(Boolean);

    // Ordenar (Cached primeiro)
    finalStreams.sort((a, b) => b.title.includes('⚡') - a.title.includes('⚡'));
    res.json({ streams: finalStreams });
});

// RESOLVE HANDLER (Play/Download)
app.get('/resolve/:service/:key/:hash', async (req, res) => {
    const { service, key, hash } = req.params;
    
    let directLink = null;
    if (service === 'realdebrid') directLink = await resolveRealDebrid(hash, key);
    else if (service === 'torbox') directLink = await resolveTorBox(hash, key);

    if (directLink) {
        res.redirect(directLink);
    } else {
        // Se não tem link direto, redireciona para um vídeo de aviso
        // Isso evita o erro "ERR_OPENING_MEDIA" no Stremio
        res.redirect(DOWNLOAD_NOTIFY_VIDEO);
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Addon rodando na porta ${PORT}`);
});

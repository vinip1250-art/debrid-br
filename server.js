const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');

const app = express();
app.use(cors());

// ============================================================
// 1. MANIFESTO (v3.1.0 - Wrapper StremThru)
// ============================================================
const manifest = {
    id: 'community.brazuca.wrapper.multi',
    version: '3.1.0',
    name: 'Brazuca Multi-Debrid',
    description: 'Brazuca envolvido pelo StremThru. Suporte simultâneo a RD e TorBox.',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    logo: "https://i.imgur.com/wE8sHHn.png"
};

const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club";

// ============================================================
// 2. HTML DA PÁGINA DE CONFIGURAÇÃO
// ============================================================
const configureHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Wrapper</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; color: #e2e8f0; }
        .card { background-color: #1e293b; border: 1px solid #334155; }
        .input-dark { background-color: #0f172a; border: 1px solid #334155; color: white; }
        .input-dark:focus { border-color: #3b82f6; outline: none; }
        .chk-group input:checked + div { border-color: #3b82f6; background-color: #1e3a8a; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-lg card rounded-xl shadow-2xl p-8">
        
        <div class="text-center mb-8">
            <h1 class="text-3xl font-bold text-blue-400 mb-2">Brazuca Wrapper</h1>
            <p class="text-sm text-gray-400">Torrents Brasileiros via StremThru</p>
        </div>

        <form id="configForm" class="space-y-6">
            
            <!-- Instância StremThru -->
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase mb-2">Instância StremThru</label>
                <select id="stremthru_host" class="w-full input-dark p-3 rounded-lg text-sm cursor-pointer">
                    <option value="https://stremthru.13377001.xyz">Midnight (Padrão)</option>
                    <option value="https://stremthru.elfhosted.com">ElfHosted</option>
                    <option value="https://api.stremthru.xyz">Oficial (Requer Store)</option>
                </select>
                <p class="text-xs text-gray-500 mt-1">O servidor que fará a ponte com o Debrid.</p>
            </div>

            <div class="border-t border-gray-700 my-4"></div>
            
            <div class="bg-blue-900/30 p-4 rounded-lg border border-blue-800 text-xs text-blue-200">
                <strong>Nota:</strong> Use o <b>Token de Autorização</b> gerado no site do StremThru, não a chave direta do Real-Debrid.
            </div>

            <!-- Real Debrid -->
            <label class="chk-group cursor-pointer block">
                <input type="checkbox" id="enable_rd" class="hidden" onchange="toggleInputs()">
                <div class="p-4 rounded-lg border border-gray-700 transition-all hover:bg-slate-800">
                    <div class="flex items-center gap-3">
                        <span class="text-xl">🌍</span>
                        <div class="flex flex-col">
                            <span class="font-bold">Real-Debrid</span>
                            <span class="text-xs text-gray-400">Ativar na lista</span>
                        </div>
                    </div>
                </div>
            </label>
            <div id="rd_input_group" class="hidden mt-2 pl-4 border-l-2 border-blue-500">
                <input type="text" id="rd_token" placeholder="Cole o Token StremThru para RD" class="w-full input-dark p-3 rounded-lg text-sm">
            </div>

            <!-- TorBox -->
            <label class="chk-group cursor-pointer block">
                <input type="checkbox" id="enable_tb" class="hidden" onchange="toggleInputs()">
                <div class="p-4 rounded-lg border border-gray-700 transition-all hover:bg-slate-800">
                    <div class="flex items-center gap-3">
                        <span class="text-xl">🟣</span>
                        <div class="flex flex-col">
                            <span class="font-bold">TorBox</span>
                            <span class="text-xs text-gray-400">Ativar na lista</span>
                        </div>
                    </div>
                </div>
            </label>
            <div id="tb_input_group" class="hidden mt-2 pl-4 border-l-2 border-purple-500">
                <input type="text" id="tb_token" placeholder="Cole o Token StremThru para TB" class="w-full input-dark p-3 rounded-lg text-sm">
            </div>

            <!-- Botão Instalar -->
            <button type="button" onclick="generateLink()" id="installBtn" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-lg transition-all opacity-50 cursor-not-allowed">
                GERAR MANIFESTO
            </button>

        </form>
    </div>

    <script>
        function toggleInputs() {
            const rd = document.getElementById('enable_rd').checked;
            const tb = document.getElementById('enable_tb').checked;
            
            document.getElementById('rd_input_group').classList.toggle('hidden', !rd);
            document.getElementById('tb_input_group').classList.toggle('hidden', !tb);
            
            validate();
        }

        function validate() {
            const rd = document.getElementById('enable_rd').checked;
            const tb = document.getElementById('enable_tb').checked;
            const rdT = document.getElementById('rd_token').value.trim();
            const tbT = document.getElementById('tb_token').value.trim();
            const btn = document.getElementById('installBtn');

            // Lógica: Precisa ter pelo menos um selecionado E com a chave preenchida
            let valid = false;
            
            if (rd && rdT) valid = true;
            if (tb && tbT) valid = true;
            
            // Se marcou mas não preencheu, invalida
            if (rd && !rdT) valid = false;
            if (tb && !tbT) valid = false;
            
            // Se nenhum marcado, invalida
            if (!rd && !tb) valid = false;

            if (valid) {
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            } else {
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            }
        }

        document.getElementById('rd_token').addEventListener('input', validate);
        document.getElementById('tb_token').addEventListener('input', validate);

        function generateLink() {
            const rd = document.getElementById('enable_rd').checked;
            const tb = document.getElementById('enable_tb').checked;
            
            let host = document.getElementById('stremthru_host').value;
            host = host.replace(/\\/$/, ''); // Remove barra final

            const config = {
                host: host,
                rd: rd ? document.getElementById('rd_token').value.trim() : null,
                tb: tb ? document.getElementById('tb_token').value.trim() : null
            };

            const json = JSON.stringify(config);
            const b64 = btoa(json);
            const safeConfig = encodeURIComponent(b64);
            
            // Redireciona para o Stremio
            window.location.href = 'stremio://' + window.location.host + '/' + safeConfig + '/manifest.json';
        }
    </script>
</body>
</html>
`;

// ============================================================
// 3. ROTAS E LÓGICA DO WRAPPER
// ============================================================

app.get('/', (req, res) => res.redirect('/configure'));
app.get('/configure', (req, res) => res.send(configureHtml));

app.get('/:config/manifest.json', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const m = { ...manifest };
    
    try {
        const decoded = decodeURIComponent(req.params.config);
        const cfg = JSON.parse(Buffer.from(decoded, 'base64').toString());
        
        // Personaliza o nome do addon no Stremio
        let services = [];
        if (cfg.rd) services.push("RD");
        if (cfg.tb) services.push("TB");
        
        if (services.length > 0) {
            m.name = `Brazuca [${services.join('+')}]`;
            m.behaviorHints = { configurable: true, configurationRequired: false };
        }
    } catch (e) {}
    
    res.json(m);
});

// AQUI ESTÁ A MÁGICA DA DUPLICAÇÃO
app.get('/:config/stream/:type/:id.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    let cfg;
    try {
        const decoded = decodeURIComponent(req.params.config);
        cfg = JSON.parse(Buffer.from(decoded, 'base64').toString());
    } catch (e) {
        return res.json({ streams: [] });
    }

    // 1. Busca os torrents no Brazuca Original
    let streams = [];
    try {
        const url = `${BRAZUCA_UPSTREAM}/stream/${req.params.type}/${req.params.id}.json`;
        const resp = await axios.get(url, { timeout: 8000 }); // Timeout generoso
        streams = resp.data.streams || [];
    } catch (e) {
        console.error("Erro ao buscar no Brazuca:", e.message);
        return res.json({ streams: [] });
    }

    if (!streams.length) return res.json({ streams: [] });

    // 2. Processa e Duplica conforme a configuração
    const wrappedStreams = [];
    const stremThruBase = (cfg.host || 'https://stremthru.13377001.xyz').replace(/\/$/, '');

    streams.forEach(stream => {
        let magnet = stream.url;
        
        // Se o Brazuca mandar apenas infoHash, montamos o magnet
        if (!magnet && stream.infoHash) {
            magnet = `magnet:?xt=urn:btih:${stream.infoHash}`;
        }
        
        // Se ainda não tiver magnet, pula
        if (!magnet) return;

        // Limpa o título (Remove quebras de linha que o Brazuca às vezes tem)
        const cleanTitle = (stream.title || 'Unknown').replace(/\n/g, ' ').trim();
        
        // Formata os detalhes extras
        let details = "";
        if (stream.behaviorHints && stream.behaviorHints.bingeGroup) {
            details += stream.behaviorHints.bingeGroup;
        }

        // -- Lógica para Real-Debrid --
        if (cfg.rd) {
            wrappedStreams.push({
                name: `Brazuca [RD]`,
                title: `${cleanTitle}\n⚙️ Real-Debrid via StremThru`,
                url: `${stremThruBase}/v0/stream?link=${encodeURIComponent(magnet)}&authorization=${cfg.rd}`,
                behaviorHints: {
                    bingeGroup: `brazuca-rd-${stream.infoHash || 'grp'}`,
                    notWebReady: false 
                }
            });
        }

        // -- Lógica para TorBox --
        if (cfg.tb) {
            wrappedStreams.push({
                name: `Brazuca [TB]`,
                title: `${cleanTitle}\n⚙️ TorBox via StremThru`,
                url: `${stremThruBase}/v0/stream?link=${encodeURIComponent(magnet)}&authorization=${cfg.tb}`,
                behaviorHints: {
                    bingeGroup: `brazuca-tb-${stream.infoHash || 'grp'}`,
                    notWebReady: false 
                }
            });
        }
    });

    res.json({ streams: wrappedStreams });
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Brazuca Wrapper rodando na porta ${PORT}`);
});

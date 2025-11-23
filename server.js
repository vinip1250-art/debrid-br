const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json";
const NEW_NAME = "Brazuca"; // Nome encurtado
const NEW_LOGO = "https://i.imgur.com/Q61eP9V.png"; // Ícone novo (Exemplo: Bandeira BR redonda ou similar)

// ============================================================
// ROTA PROXY (Essa rota cria o manifesto modificado)
// ============================================================
app.get('/brazuca.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    try {
        // 1. Baixa o manifesto original do Brazuca
        const response = await axios.get(BRAZUCA_UPSTREAM);
        const manifest = response.data;

        // 2. Modifica o Nome e Ícone
        manifest.id = 'community.brazuca.modified.proxy'; // Novo ID para evitar conflitos
        manifest.name = NEW_NAME;
        manifest.description = "Brazuca modificado para StremThru (Nome Curto)";
        manifest.logo = NEW_LOGO;
        
        // 3. Retorna o manifesto modificado
        res.json(manifest);
    } catch (error) {
        console.error("Erro ao buscar manifesto original:", error.message);
        res.status(500).json({ error: "Falha ao obter manifesto original" });
    }
});

// ============================================================
// HTML DO GERADOR
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca Wrapper</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f1115; color: #e2e8f0; font-family: sans-serif; }
        .card { background-color: #181b21; border: 1px solid #2d3748; }
        .input-dark { background-color: #0f1115; border: 1px solid #2d3748; color: white; transition: all 0.2s; }
        .input-dark:focus { border-color: #6366f1; outline: none; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2); }
        select option { background-color: #0f1115; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <div class="w-full max-w-xl card rounded-2xl shadow-2xl overflow-hidden">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-center">
            <img src="${NEW_LOGO}" class="w-16 h-16 mx-auto mb-3 rounded-full shadow-lg border-2 border-white/20">
            <h1 class="text-2xl font-bold text-white tracking-tight">Gerador Brazuca Pro</h1>
            <p class="text-blue-100 text-xs mt-1">RD & TorBox Simultâneos • Nome Curto</p>
        </div>

        <div class="p-8 space-y-6">
            
            <!-- 1. Instância -->
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">1. Instância StremThru</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm cursor-pointer">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Estável)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight (Weebs Edition)</option>
                    <option value="https://stremthru.midnightignite.me">Midnight (Padrão)</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- 2. Debrids -->
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase mb-3 ml-1">2. Configure os Serviços</label>
                
                <div class="space-y-3">
                    <!-- Real Debrid -->
                    <div class="bg-[#0f1115] p-4 rounded-xl border border-gray-800 hover:border-indigo-500/50 transition-colors">
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="use_rd" class="w-5 h-5 accent-indigo-500 rounded" onchange="toggleInputs()">
                            <div class="flex-1">
                                <span class="text-sm font-bold text-white">Real-Debrid</span>
                            </div>
                        </label>
                        <div id="rd_area" class="hidden mt-3 pt-3 border-t border-gray-800">
                            <input type="text" id="rd_key" placeholder="Token do Store 'rd' (StremThru)" class="w-full input-dark p-2.5 rounded text-xs text-gray-300">
                        </div>
                    </div>

                    <!-- TorBox -->
                    <div class="bg-[#0f1115] p-4 rounded-xl border border-gray-800 hover:border-purple-500/50 transition-colors">
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" id="use_tb" class="w-5 h-5 accent-purple-500 rounded" onchange="toggleInputs()">
                            <div class="flex-1">
                                <span class="text-sm font-bold text-white">TorBox</span>
                            </div>
                        </label>
                        <div id="tb_area" class="hidden mt-3 pt-3 border-t border-gray-800">
                            <input type="text" id="tb_key" placeholder="Token do Store 'tb' (StremThru)" class="w-full input-dark p-2.5 rounded text-xs text-gray-300">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Botão -->
            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all opacity-50 cursor-not-allowed shadow-lg shadow-indigo-900/20">
                GERAR LINK
            </button>

        </div>
        
        <div class="bg-[#0f1115] p-3 text-center border-t border-gray-800">
            <p class="text-[10px] text-gray-600">Gera um link wrap automatizado.</p>
        </div>
    </div>

    <script>
        const instanceSelect = document.getElementById('instance');
        const customInput = document.getElementById('custom_instance');

        instanceSelect.addEventListener('change', (e) => {
            if(e.target.value === 'custom') customInput.classList.remove('hidden');
            else customInput.classList.add('hidden');
        });

        function toggleInputs() {
            const rd = document.getElementById('use_rd').checked;
            const tb = document.getElementById('use_tb').checked;
            
            document.getElementById('rd_area').style.display = rd ? 'block' : 'none';
            document.getElementById('tb_area').style.display = tb ? 'block' : 'none';
            validate();
        }

        function validate() {
            const rd = document.getElementById('use_rd').checked;
            const tb = document.getElementById('use_tb').checked;
            const rdKey = document.getElementById('rd_key').value.trim();
            const tbKey = document.getElementById('tb_key').value.trim();
            const btn = document.getElementById('btnGenerate');

            let isValid = false;
            if (rd && rdKey) isValid = true;
            if (tb && tbKey) isValid = true;
            if (rd && !rdKey) isValid = false;
            if (tb && !tbKey) isValid = false;
            if (!rd && !tb) isValid = false;

            if(isValid) {
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
                btn.disabled = false;
            } else {
                btn.classList.add('opacity-50', 'cursor-not-allowed');
                btn.disabled = true;
            }
        }

        document.getElementById('rd_key').addEventListener('input', validate);
        document.getElementById('tb_key').addEventListener('input', validate);

        function generate() {
            const useRd = document.getElementById('use_rd').checked;
            const useTb = document.getElementById('use_tb').checked;
            
            let host = instanceSelect.value;
            if (host === 'custom') host = customInput.value.trim();
            host = host.replace(/\\/$/, '');
            if (!host.startsWith('http')) host = 'https://' + host;

            // PULO DO GATO: Usamos o NOSSO proxy local como upstream
            // Assim o StremThru vê o manifesto com nome curto e ícone novo
            const myProxyUrl = window.location.origin + "/brazuca.json";

            let config = {
                upstreams: [],
                stores: []
            };

            // Adiciona RD
            if (useRd) {
                config.upstreams.push({ u: myProxyUrl });
                config.stores.push({
                    c: "rd", // Código da loja no StremThru
                    t: document.getElementById('rd_key').value.trim()
                });
            }

            // Adiciona TB
            if (useTb) {
                config.upstreams.push({ u: myProxyUrl });
                config.stores.push({
                    c: "tb", // Código da loja no StremThru
                    t: document.getElementById('tb_key').value.trim()
                });
            }

            const jsonStr = JSON.stringify(config);
            const base64Config = btoa(jsonStr);

            // Remove protocolo para stremio://
            const hostClean = host.replace('https://', '').replace('http://', '');
            const finalLink = \`stremio://\${hostClean}/stremio/wrap/\${base64Config}/manifest.json\`;

            window.location.href = finalLink;
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));

// Redireciona rotas desconhecidas
app.get('*', (req, res) => {
    if (req.path === '/brazuca.json') return; // Não redireciona a rota do manifesto
    res.redirect('/');
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});

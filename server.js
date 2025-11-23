const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());

// ============================================================
// CONFIGURAÇÕES
// ============================================================
const BRAZUCA_UPSTREAM = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json";
const NEW_NAME = "Brazuca"; 
const NEW_LOGO = "https://i.imgur.com/Q61eP9V.png";

// ============================================================
// ROTA PROXY (Cria manifesto modificado)
// ============================================================
app.get('/brazuca.json', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    
    try {
        const response = await axios.get(BRAZUCA_UPSTREAM);
        const manifest = response.data;

        manifest.id = 'community.brazuca.modified.proxy';
        manifest.name = NEW_NAME;
        manifest.description = "Brazuca via StremThru (Dual Debrid)";
        manifest.logo = NEW_LOGO;
        
        res.json(manifest);
    } catch (error) {
        res.status(500).json({ error: "Falha no upstream" });
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { background-color: #0f1115; color: #e2e8f0; font-family: 'Segoe UI', sans-serif; }
        .card { background-color: #181b21; border: 1px solid #2d3748; }
        .input-dark { background-color: #0f1115; border: 1px solid #2d3748; color: white; }
        .input-dark:focus { border-color: #6366f1; outline: none; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2); }
        
        /* Animação de sucesso */
        @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
        .toast { animation: fadeOut 2s forwards; animation-delay: 1s; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4">

    <div class="w-full max-w-xl card rounded-2xl shadow-2xl overflow-hidden relative">
        
        <!-- Header -->
        <div class="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-center">
            <img src="${NEW_LOGO}" class="w-14 h-14 mx-auto mb-3 rounded-full shadow-lg border-2 border-white/20">
            <h1 class="text-2xl font-bold text-white">Gerador Brazuca Pro</h1>
            <p class="text-blue-100 text-xs mt-1">Wrapper StremThru • RD & TorBox</p>
        </div>

        <div class="p-8 space-y-6">
            
            <!-- 1. Instância -->
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">1. Instância StremThru</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm cursor-pointer">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Estável)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight (Alternativa)</option>
                    <option value="https://stremthru.midnightignite.me">Midnight (Padrão)</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- 2. Debrids -->
            <div class="space-y-3">
                <label class="block text-xs font-bold text-gray-400 uppercase ml-1">2. Serviços</label>
                
                <!-- RD -->
                <div class="bg-[#0f1115] p-3 rounded-xl border border-gray-800">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="use_rd" class="w-4 h-4 accent-indigo-500" onchange="toggleInputs()">
                        <span class="text-sm font-bold text-white">Real-Debrid</span>
                    </label>
                    <div id="rd_area" class="hidden mt-2 pt-2 border-t border-gray-800">
                        <input type="text" id="rd_key" placeholder="Token Store 'rd' (StremThru)" class="w-full input-dark p-2 rounded text-xs text-gray-300">
                    </div>
                </div>

                <!-- TB -->
                <div class="bg-[#0f1115] p-3 rounded-xl border border-gray-800">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="use_tb" class="w-4 h-4 accent-purple-500" onchange="toggleInputs()">
                        <span class="text-sm font-bold text-white">TorBox</span>
                    </label>
                    <div id="tb_area" class="hidden mt-2 pt-2 border-t border-gray-800">
                        <input type="text" id="tb_key" placeholder="Token Store 'tb' (StremThru)" class="w-full input-dark p-2 rounded text-xs text-gray-300">
                    </div>
                </div>
            </div>

            <!-- Área de Resultado (Inicialmente Oculta) -->
            <div id="resultArea" class="hidden space-y-3 pt-4 border-t border-gray-700">
                <label class="block text-xs font-bold text-green-400 uppercase ml-1">Link Gerado</label>
                
                <!-- Input com o link para copiar -->
                <div class="flex gap-2">
                    <input type="text" id="finalUrl" readonly class="w-full input-dark p-3 rounded-lg text-xs text-gray-400 select-all">
                    <button onclick="copyLink()" class="bg-gray-700 hover:bg-gray-600 text-white p-3 rounded-lg transition" title="Copiar">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>

                <!-- Botão Instalar -->
                <a id="installBtn" href="#" class="block w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-center transition shadow-lg shadow-indigo-900/20">
                    <i class="fas fa-play mr-2"></i> INSTALAR NO STREMIO
                </a>
            </div>

            <!-- Botão Gerar (Some após gerar) -->
            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-700 text-gray-400 font-bold py-3 rounded-xl transition cursor-not-allowed" disabled>
                PREENCHA OS DADOS
            </button>

        </div>
    </div>

    <!-- Toast Notification -->
    <div id="toast" class="fixed bottom-5 right-5 bg-green-600 text-white px-4 py-2 rounded-lg shadow-xl hidden">
        Copiado com sucesso!
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
            if ((rd && rdKey) || (tb && tbKey)) isValid = true;
            if (rd && !rdKey) isValid = false;
            if (tb && !tbKey) isValid = false;
            if (!rd && !tb) isValid = false;

            if(isValid) {
                btn.classList.remove('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
                btn.classList.add('bg-indigo-600', 'hover:bg-indigo-500', 'text-white');
                btn.innerText = "GERAR CONFIGURAÇÃO";
                btn.disabled = false;
            } else {
                btn.classList.add('bg-gray-700', 'text-gray-400', 'cursor-not-allowed');
                btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500', 'text-white');
                btn.innerText = "PREENCHA OS DADOS";
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

            const myProxyUrl = window.location.origin + "/brazuca.json";

            let config = { upstreams: [], stores: [] };

            if (useRd) {
                config.upstreams.push({ u: myProxyUrl });
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (useTb) {
                config.upstreams.push({ u: myProxyUrl });
                config.stores.push({ c: "tb", t: document.getElementById('tb_key').value.trim() });
            }

            const jsonStr = JSON.stringify(config);
            const base64Config = btoa(jsonStr);
            
            const hostClean = host.replace('https://', '').replace('http://', '');
            const stremioUrl = \`stremio://\${hostClean}/stremio/wrap/\${base64Config}/manifest.json\`;
            const httpsUrl = \`\${host}/stremio/wrap/\${base64Config}/manifest.json\`;

            // Mostrar resultado
            document.getElementById('btnGenerate').classList.add('hidden');
            document.getElementById('resultArea').classList.remove('hidden');
            
            const finalInput = document.getElementById('finalUrl');
            finalInput.value = httpsUrl; // URL HTTPS para copiar
            
            document.getElementById('installBtn').href = stremioUrl; // Link Stremio para instalar
        }

        function copyLink() {
            const copyText = document.getElementById("finalUrl");
            copyText.select();
            copyText.setSelectionRange(0, 99999); 
            document.execCommand("copy"); // Fallback seguro
            
            // Mostrar Toast
            const toast = document.getElementById('toast');
            toast.classList.remove('hidden');
            toast.classList.add('toast');
            setTimeout(() => {
                toast.classList.add('hidden');
                toast.classList.remove('toast');
            }, 3000);
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));

app.get('*', (req, res) => {
    if (req.path === '/brazuca.json') return; 
    res.redirect('/');
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});

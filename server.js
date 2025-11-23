const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

// ============================================================
// HTML DO GERADOR (INTERFACE DE CONFIGURAÇÃO)
// ============================================================
const generatorHtml = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Brazuca StremThru Generator</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0b0c10; color: #c5c6c7; font-family: sans-serif; }
        .card { background-color: #1f2833; border: 1px solid #45a29e; box-shadow: 0 0 15px rgba(102, 252, 241, 0.1); }
        .input-dark { background-color: #0b0c10; border: 1px solid #45a29e; color: #fff; }
        .input-dark:focus { box-shadow: 0 0 8px #66fcf1; outline: none; }
        .btn-action { background: linear-gradient(90deg, #45a29e 0%, #66fcf1 100%); color: #0b0c10; font-weight: bold; }
        .btn-action:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(102, 252, 241, 0.4); }
        select option { background-color: #0b0c10; color: white; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-black to-gray-900">

    <div class="w-full max-w-2xl card rounded-2xl p-8 relative overflow-hidden">
        <div class="text-center mb-10">
            <h1 class="text-4xl font-extrabold text-[#66fcf1] mb-2">Brazuca <span class="text-white">Wrapper</span></h1>
            <p class="text-gray-400 text-sm">Gerador de manifesto StremThru automatizado</p>
        </div>

        <form id="configForm" class="space-y-8">
            
            <!-- 1. Instância -->
            <div class="space-y-2">
                <label class="text-xs font-bold text-[#66fcf1] uppercase tracking-wider">1. Escolha a Instância StremThru</label>
                <select id="instance" class="w-full input-dark p-4 rounded-xl text-sm cursor-pointer appearance-none">
                    <option value="https://stremthru.midnightignite.me">Midnight Ignite (Recomendado)</option>
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Estável)</option>
                    <option value="https://api.stremthru.xyz">StremThru Oficial</option>
                    <option value="custom">Outra (Digitar URL...)</option>
                </select>
                <input type="text" id="custom_instance" placeholder="Ex: https://minha-instancia.com" class="hidden w-full input-dark p-4 rounded-xl text-sm mt-2">
            </div>

            <!-- 2. Debrids -->
            <div class="space-y-4">
                <label class="text-xs font-bold text-[#66fcf1] uppercase tracking-wider">2. Configure seus Debrids</label>
                
                <!-- Real Debrid -->
                <div class="bg-[#0b0c10] p-4 rounded-xl border border-gray-800 hover:border-blue-500 transition-colors">
                    <label class="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox" id="use_rd" class="w-5 h-5 accent-[#66fcf1]" onchange="toggleInputs()">
                        <span class="text-lg font-bold text-white">Real-Debrid</span>
                    </label>
                    <div id="rd_area" class="hidden pl-8">
                        <input type="text" id="rd_key" placeholder="Cole sua API Key do Real-Debrid aqui" class="w-full input-dark p-3 rounded-lg text-sm text-gray-300 placeholder-gray-600">
                    </div>
                </div>

                <!-- TorBox -->
                <div class="bg-[#0b0c10] p-4 rounded-xl border border-gray-800 hover:border-purple-500 transition-colors">
                    <label class="flex items-center gap-3 cursor-pointer mb-3">
                        <input type="checkbox" id="use_tb" class="w-5 h-5 accent-[#66fcf1]" onchange="toggleInputs()">
                        <span class="text-lg font-bold text-white">TorBox</span>
                    </label>
                    <div id="tb_area" class="hidden pl-8">
                        <input type="text" id="tb_key" placeholder="Cole sua API Key do TorBox aqui" class="w-full input-dark p-3 rounded-lg text-sm text-gray-300 placeholder-gray-600">
                    </div>
                </div>
            </div>

            <!-- Botão -->
            <button type="button" onclick="generate()" id="btnGenerate" class="w-full btn-action py-4 rounded-xl text-lg uppercase tracking-widest transition-all opacity-50 cursor-not-allowed">
                Instalar no Stremio
            </button>

        </form>
    </div>

    <script>
        // URL do Manifesto do Brazuca Original
        const BRAZUCA_MANIFEST_URL = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json";

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

            if(isValid) btn.classList.remove('opacity-50', 'cursor-not-allowed');
            else btn.classList.add('opacity-50', 'cursor-not-allowed');
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

            // Constroi o JSON exatamente como o exemplo que funcionou
            let config = {
                upstreams: [],
                stores: []
            };

            // Se RD ativado, adiciona uma entrada de upstream e store
            if (useRd) {
                config.upstreams.push({ u: BRAZUCA_MANIFEST_URL });
                config.stores.push({
                    c: "rd",
                    t: document.getElementById('rd_key').value.trim()
                });
            }

            // Se TB ativado, adiciona outra entrada de upstream e store
            // Isso força a duplicação dos resultados na lista do Stremio
            if (useTb) {
                config.upstreams.push({ u: BRAZUCA_MANIFEST_URL });
                config.stores.push({
                    c: "tb",
                    t: document.getElementById('tb_key').value.trim()
                });
            }

            const jsonStr = JSON.stringify(config);
            const base64Config = btoa(jsonStr);

            // Remove protocolo para criar link stremio://
            const hostClean = host.replace('https://', '').replace('http://', '');
            const finalLink = \`stremio://\${hostClean}/stremio/wrap/\${base64Config}/manifest.json\`;

            window.location.href = finalLink;
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));

// Redireciona tudo para a home
app.get('*', (req, res) => res.redirect('/'));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});

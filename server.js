const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());

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
        body { background-color: #0b0c10; color: #c5c6c7; font-family: 'Segoe UI', sans-serif; }
        .card { background-color: #181b21; border: 1px solid #2d3748; }
        .input-dark { background-color: #0f1115; border: 1px solid #2d3748; color: white; }
        .input-dark:focus { border-color: #6366f1; outline: none; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2); }
        .btn-action { background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%); color: white; font-weight: bold; }
        .btn-action:hover { transform: translateY(-1px); filter: brightness(1.1); }
        
        /* Toast Anim */
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .toast { animation: slideUp 0.3s ease-out; }
    </style>
</head>
<body class="min-h-screen flex items-center justify-center p-4 bg-black">

    <div class="w-full max-w-lg card rounded-2xl shadow-2xl overflow-hidden relative border border-gray-800">
        
        <!-- Cabeçalho -->
        <div class="bg-[#111] p-6 text-center border-b border-gray-800">
            <h1 class="text-2xl font-bold text-white tracking-tight">Brazuca Wrapper</h1>
            <p class="text-gray-500 text-xs mt-1">Gerador de Links StremThru Estável</p>
        </div>

        <div class="p-6 space-y-6">
            
            <!-- 1. Instância -->
            <div>
                <label class="block text-xs font-bold text-gray-400 uppercase mb-2 ml-1">1. Escolha a Instância</label>
                <select id="instance" class="w-full input-dark p-3 rounded-lg text-sm cursor-pointer">
                    <option value="https://stremthru.elfhosted.com">ElfHosted (Mais Estável)</option>
                    <option value="https://stremthru.midnightignite.me">Midnight (Padrão)</option>
                    <option value="https://stremthrufortheweebs.midnightignite.me">Midnight (Weebs)</option>
                    <option value="https://api.stremthru.xyz">Oficial</option>
                    <option value="custom">Outra...</option>
                </select>
                <input type="text" id="custom_instance" placeholder="https://..." class="hidden w-full input-dark p-3 rounded-lg text-sm mt-2">
            </div>

            <!-- 2. Serviços -->
            <div class="space-y-3">
                <label class="block text-xs font-bold text-gray-400 uppercase ml-1">2. Configurar Debrid</label>
                
                <!-- RD -->
                <div class="bg-[#0f1115] p-3 rounded-lg border border-gray-800">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="use_rd" class="w-4 h-4 accent-indigo-500" onchange="toggleInputs()">
                        <span class="text-sm font-bold text-white">Real-Debrid</span>
                    </label>
                    <div id="rd_area" class="hidden mt-2 pt-2 border-t border-gray-800">
                        <input type="text" id="rd_key" placeholder="Token Store 'rd' (StremThru)" class="w-full input-dark p-2 rounded text-xs text-gray-300">
                        <p class="text-[10px] text-gray-600 mt-1">Não é a API Key! É o Token do StremThru Manager.</p>
                    </div>
                </div>

                <!-- TB -->
                <div class="bg-[#0f1115] p-3 rounded-lg border border-gray-800">
                    <label class="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" id="use_tb" class="w-4 h-4 accent-purple-500" onchange="toggleInputs()">
                        <span class="text-sm font-bold text-white">TorBox</span>
                    </label>
                    <div id="tb_area" class="hidden mt-2 pt-2 border-t border-gray-800">
                        <input type="text" id="tb_key" placeholder="Token Store 'tb' (StremThru)" class="w-full input-dark p-2 rounded text-xs text-gray-300">
                    </div>
                </div>
            </div>

            <!-- Área de Resultado -->
            <div id="resultArea" class="hidden space-y-3 pt-4 border-t border-gray-800">
                <div class="bg-green-900/20 border border-green-800 rounded-lg p-3">
                    <p class="text-green-400 text-xs font-bold mb-1">URL Gerada:</p>
                    <div class="flex gap-2">
                        <input type="text" id="finalUrl" readonly class="w-full bg-black/50 border border-green-900 rounded px-2 py-1 text-[10px] text-gray-400 font-mono truncate">
                        <button onclick="copyLink()" class="bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded text-xs font-bold transition">
                            COPIAR
                        </button>
                    </div>
                </div>

                <a id="installBtn" href="#" class="block w-full btn-action py-3 rounded-xl text-center shadow-lg shadow-indigo-900/20 text-sm uppercase tracking-widest">
                    INSTALAR NO STREMIO
                </a>
            </div>

            <!-- Botão Gerar -->
            <button type="button" onclick="generate()" id="btnGenerate" class="w-full bg-gray-800 text-gray-500 font-bold py-3 rounded-xl transition cursor-not-allowed text-sm uppercase" disabled>
                PREENCHA OS DADOS
            </button>

        </div>
    </div>

    <!-- Toast -->
    <div id="toast" class="fixed bottom-5 left-1/2 transform -translate-x-1/2 bg-white text-black px-6 py-2 rounded-full shadow-2xl font-bold text-xs hidden toast">
        URL COPIADA!
    </div>

    <script>
        // URL Direta do Brazuca (Sem Proxy para evitar erro 400)
        const BRAZUCA_DIRECT = "https://94c8cb9f702d-brazuca-torrents.baby-beamup.club/manifest.json";

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
                btn.classList.remove('bg-gray-800', 'text-gray-500', 'cursor-not-allowed');
                btn.classList.add('btn-action', 'cursor-pointer');
                btn.innerText = "GERAR LINK";
                btn.disabled = false;
            } else {
                btn.classList.add('bg-gray-800', 'text-gray-500', 'cursor-not-allowed');
                btn.classList.remove('btn-action', 'cursor-pointer');
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

            let config = { upstreams: [], stores: [] };

            // Usamos o link direto do Brazuca para evitar erros de rede no StremThru
            if (useRd) {
                config.upstreams.push({ u: BRAZUCA_DIRECT });
                config.stores.push({ c: "rd", t: document.getElementById('rd_key').value.trim() });
            }
            if (useTb) {
                config.upstreams.push({ u: BRAZUCA_DIRECT });
                config.stores.push({ c: "tb", t: document.getElementById('tb_key').value.trim() });
            }

            const jsonStr = JSON.stringify(config);
            const base64Config = btoa(jsonStr);
            
            // URLs
            const httpsUrl = \`\${host}/stremio/wrap/\${base64Config}/manifest.json\`;
            // Para o botão, removemos o protocolo para abrir direto no app
            const stremioProtocol = host.replace('https://', '').replace('http://', '');
            const stremioUrl = \`stremio://\${stremioProtocol}/stremio/wrap/\${base64Config}/manifest.json\`;

            // UI Update
            document.getElementById('btnGenerate').classList.add('hidden');
            document.getElementById('resultArea').classList.remove('hidden');
            
            document.getElementById('finalUrl').value = httpsUrl;
            document.getElementById('installBtn').href = stremioUrl;
        }

        function copyLink() {
            const copyText = document.getElementById("finalUrl");
            copyText.select();
            copyText.setSelectionRange(0, 99999);
            
            navigator.clipboard.writeText(copyText.value).then(() => {
                showToast();
            }).catch(() => {
                // Fallback
                document.execCommand("copy");
                showToast();
            });
        }

        function showToast() {
            const toast = document.getElementById('toast');
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2000);
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(generatorHtml));
app.get('*', (req, res) => res.redirect('/'));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Gerador rodando na porta ${PORT}`);
});

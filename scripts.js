const API = window.API_URL || "http://localhost:5000";

const CORES_STATUS = {
  "Anunciado": "#5B6B78",
  "Licenciamento": "#F2D27A",
  "Em obras": "#E8A400",
  "Em operação": "#0E5A61",
  "Suspenso": "#A8432A",
};

const $ = (id) => document.getElementById(id);
let projetos = [];
let camada;

/* ---------- Mapa ---------- */
const mapa = L.map("mapa", { zoomControl: true, zoomSnap: 0.25 })
  .fitBounds([[-33.8, -73.9], [5.3, -34.8]]);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(mapa);
camada = L.layerGroup().addTo(mapa);

// Raio proporcional à raiz do investimento; projetos sem valor ficam com raio mínimo
function raio(invest) {
  return invest ? Math.max(6, Math.sqrt(invest) / 9) : 6;
}

/* ---------- Formatação ---------- */
function formatarInvest(mi) {
  if (mi == null) return "Valor não divulgado";
  if (mi >= 1000) return `R$ ${(mi / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
  return `R$ ${mi.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mi`;
}

function esc(txt) {
  const d = document.createElement("div");
  d.textContent = txt ?? "";
  return d.innerHTML;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("on"), 3000);
}

/* ---------- Chamadas à API ---------- */
async function api(caminho, opcoes = {}) {
  const resp = await fetch(`${API}${caminho}`, {
    headers: { "Content-Type": "application/json" },
    ...opcoes,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Erros de validação do flask-openapi3 vêm como lista
    const msg = Array.isArray(dados)
      ? dados.map((e) => `${e.loc?.join(".")}: ${e.msg}`).join("; ")
      : dados.mensagem || `Erro ${resp.status}`;
    throw new Error(msg);
  }
  return dados;
}

async function carregar() {
  const params = new URLSearchParams();
  if ($("fUf").value) params.set("uf", $("fUf").value);
  if ($("fStatus").value) params.set("status", $("fStatus").value);
  try {
    const [lista, resumo] = await Promise.all([
      api(`/projetos?${params}`),
      api("/resumo"),
    ]);
    projetos = lista.projetos;
    renderResumo(resumo);
    renderLista();
    renderMapa();
  } catch (e) {
    $("lista").innerHTML = `<li class="vazio">Não foi possível falar com a API em ${esc(API)}. Verifique se ela está rodando.</li>`;
  }
}

/* ---------- Renderização ---------- */
function renderResumo(r) {
  $("totProjetos").textContent = r.total_projetos;
  $("totInvest").textContent = r.investimento_total_mi ? formatarInvest(r.investimento_total_mi) : "–";
  $("totUf").textContent = Object.keys(r.por_uf).length;

  const ufSel = $("fUf").value;
  const ufs = Object.keys(r.por_uf).sort();
  $("fUf").innerHTML = `<option value="">Todos</option>` +
    ufs.map((uf) => `<option ${uf === ufSel ? "selected" : ""}>${uf}</option>`).join("");
  $("setores").innerHTML = Object.keys(r.por_setor).map((s) => `<option value="${esc(s)}">`).join("");
}

function renderLista() {
  const ul = $("lista");
  if (!projetos.length) {
    ul.innerHTML = `<li class="vazio">Nenhum projeto com esses filtros. Limpe os filtros ou cadastre um novo.</li>`;
    return;
  }
  ul.innerHTML = projetos.map((p) => `
    <li tabindex="0" data-id="${p.id}">
      <span class="nome">${esc(p.nome)}</span>
      <span class="valor">${p.investimento_mi != null ? formatarInvest(p.investimento_mi) : "–"}</span>
      <span class="meta"><span class="selo" style="background:${CORES_STATUS[p.status]}"></span>${esc(p.empresa)}, ${esc(p.cidade)}/${esc(p.uf)}</span>
    </li>`).join("");
}

const marcadores = {};
function renderMapa() {
  camada.clearLayers();
  projetos.filter((p) => p.latitude != null).forEach((p) => {
    const m = L.circleMarker([p.latitude, p.longitude], {
      radius: raio(p.investimento_mi),
      color: "#1E2830", weight: 2,
      fillColor: "#E3A21A", fillOpacity: 0.85,
    }).bindPopup(popup(p));
    m.addTo(camada);
    marcadores[p.id] = m;
  });
}


function popup(p) {
  const fonte = p.fonte ? `<p><a href="${esc(p.fonte)}" target="_blank" rel="noopener">Ver fonte</a></p>` : "";
  return `<div class="pop">
    <h3>${esc(p.nome)}</h3>
    <p>${esc(p.empresa)}, ${esc(p.setor)}</p>
    <p>${esc(p.cidade)}/${esc(p.uf)}, ${esc(p.status)}</p>
    <p><strong>${formatarInvest(p.investimento_mi)}</strong></p>
    ${fonte}
    <div class="acoes">
      <button class="btn" onclick="abrirForm(${p.id})">Editar</button>
      <button class="btn perigo" onclick="remover(${p.id})">Remover</button>
    </div></div>`;
}

/* ---------- Formulário ---------- */
const CAMPOS = ["nome", "empresa", "setor", "cidade", "uf", "status", "fonte"];

function abrirForm(id) {
  const p = projetos.find((x) => x.id === id);
  $("form").reset();
  $("erroForm").textContent = "";
  $("pid").value = p ? p.id : "";
  $("dlgTitulo").textContent = p ? "Editar projeto" : "Cadastrar projeto";
  if (p) {
    CAMPOS.forEach((c) => ($(c).value = p[c] ?? ""));
    $("investimento").value = p.investimento_mi ?? "";
  }
  mapa.closePopup();
  $("dlg").showModal();
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const id = $("pid").value;
  const corpo = {};
  CAMPOS.forEach((c) => {
    const v = $(c).value.trim();
    corpo[c] = v === "" ? null : v;
  });
  corpo.uf = corpo.uf?.toUpperCase();
  const inv = $("investimento").value;
  corpo.investimento_mi = inv === "" ? null : Number(inv);

  $("btnSalvar").disabled = true;
  $("btnSalvar").textContent = "Salvando…";
  try {
    if (id) {
      await api(`/projetos/${id}`, { method: "PUT", body: JSON.stringify(corpo) });
      toast("Projeto atualizado");
    } else {
      await api("/projetos", { method: "POST", body: JSON.stringify(corpo) });
      toast("Projeto cadastrado");
    }
    $("dlg").close();
    await carregar();
  } catch (e) {
    $("erroForm").textContent = e.message;
  } finally {
    $("btnSalvar").disabled = false;
    $("btnSalvar").textContent = "Salvar projeto";
  }
});

async function remover(id) {
  const p = projetos.find((x) => x.id === id);
  if (!confirm(`Remover "${p.nome}"? Essa ação não pode ser desfeita.`)) return;
  try {
    await api(`/projetos/${id}`, { method: "DELETE" });
    toast("Projeto removido");
    mapa.closePopup();
    await carregar();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- Eventos ---------- */
$("btnNovo").addEventListener("click", () => abrirForm(null));
$("btnCancelar").addEventListener("click", () => $("dlg").close());
$("fUf").addEventListener("change", carregar);
$("fStatus").addEventListener("change", carregar);

function focarProjeto(li) {
  const p = projetos.find((x) => x.id === Number(li.dataset.id));
  if (!p || p.latitude == null) return;
  mapa.flyTo([p.latitude, p.longitude], 8, { duration: 0.8 });
  marcadores[p.id]?.openPopup();
}
$("lista").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) focarProjeto(li);
});
$("lista").addEventListener("keydown", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); focarProjeto(li); }
});

carregar();

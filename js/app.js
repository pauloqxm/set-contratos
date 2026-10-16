/* Estado, filtros, tabela, modal e exportação do painel. */
const FILTERS = [
  { key: "situacao", label: "Situação" },
  { key: "orgao", label: "Órgão" },
  { key: "categoria", label: "Categoria" },
  { key: "modalidade", label: "Modalidade" },
  { key: "gestor", label: "Gestor" },
  { key: "fiscal", label: "Fiscal" },
  { key: "contratada", label: "Contratada" },
];

const COLUMNS = [
  { key: "objeto", label: "Objeto" },
  { key: "orgao", label: "Órgão" },
  { key: "contratada", label: "Contratada" },
  { key: "execucao", label: "Execução" },
  { key: "contrato", label: "Contrato" },
  { key: "valorTotal", label: "Valor total", numeric: true },
  { key: "saldo", label: "Saldo", numeric: true },
  { key: "terminoEfetivo", label: "Término" },
  { key: "diasRestantes", label: "Dias restantes" },
  { key: "categoria", label: "Categoria" },
  { key: "situacao", label: "Situação" },
];

const DESC_FIRST = new Set(["valorTotal", "saldo", "execucao"]);
const SORTABLE = new Set(COLUMNS.map((column) => column.key));

const state = {
  rows: [],
  meta: null,
  filters: emptyFilters(),
  sort: { key: "diasRestantes", dir: "asc" },
  page: 1,
  pageSize: CONFIG.pageSize,
  printing: false,
  lastFocus: null,
  meeting: { startedAt: null, endedAt: null, inicio: "", fim: "", timer: null, checks: new Map() },
};

const ui = {};

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  if (!(await SSO.exigirLogin())) return;
  ui.count = document.getElementById("kpi-count");
  ui.countHint = document.getElementById("kpi-count-hint");
  ui.updated = document.getElementById("updated");
  ui.banner = document.getElementById("banner");
  ui.search = document.getElementById("search");
  ui.pageSize = document.getElementById("page-size");
  ui.refresh = document.getElementById("btn-refresh");
  ui.meeting = document.getElementById("meeting");
  ui.meetingBtn = document.getElementById("btn-meeting");
  ui.meetingEnd = document.getElementById("btn-meeting-end");
  ui.clock = document.getElementById("meeting-clock");
  ui.meetingRead = document.getElementById("meeting-read");
  ui.modal = document.getElementById("modal");
  ui.sheet = document.getElementById("sheet-link");
  if (ui.sheet) ui.sheet.href = CONFIG.sheetUrl;

  document.getElementById("alert-45").dataset.alerta = String(CONFIG.alertaCritico);
  document.getElementById("alert-100").dataset.alerta = String(CONFIG.alertaAtencao);
  document.querySelector("#alert-45 .alert-label").textContent = `em menos de ${CONFIG.alertaCritico} dias`;
  document.querySelector("#alert-100 .alert-label").textContent = `em menos de ${CONFIG.alertaAtencao} dias`;

  readHash();
  ui.search.value = state.filters.q;
  ui.pageSize.value = String(state.pageSize);
  bindEvents();
  renderHead();
  restoreMeeting();
  await reload();
}

function emptyFilters() {
  return {
    q: "",
    situacao: [],
    orgao: [],
    categoria: [],
    modalidade: [],
    gestor: [],
    fiscal: [],
    contratada: [],
    alerta: null,
    vencidos: false,
    mes: null,
  };
}

function bindEvents() {
  ui.refresh.addEventListener("click", () => reload());
  ui.meetingBtn.addEventListener("click", startMeeting);
  ui.meetingEnd.addEventListener("click", endMeeting);
  document.getElementById("btn-reset").addEventListener("click", resetFilters);
  document.getElementById("btn-csv").addEventListener("click", exportCsv);
  document.getElementById("btn-xlsx").addEventListener("click", exportXlsx);
  document.getElementById("btn-print").addEventListener("click", () => window.print());
  document.getElementById("alert-45").addEventListener("click", () => toggleAlerta(String(CONFIG.alertaCritico)));
  document.getElementById("alert-100").addEventListener("click", () => toggleAlerta(String(CONFIG.alertaAtencao)));
  document.getElementById("kpi-vencidos").addEventListener("click", toggleVencidos);
  document.getElementById("modal-close").addEventListener("click", () => ui.modal.close());
  ui.modal.addEventListener("click", (event) => {
    if (event.target === ui.modal) ui.modal.close();
  });
  ui.modal.addEventListener("close", () => {
    if (state.lastFocus) state.lastFocus.focus();
  });

  ui.search.addEventListener("input", () => {
    window.clearTimeout(ui.searchTimer);
    ui.searchTimer = window.setTimeout(() => {
      state.filters.q = ui.search.value.trim();
      state.page = 1;
      commit();
    }, 180);
  });

  ui.pageSize.addEventListener("change", () => {
    const size = Number(ui.pageSize.value);
    state.pageSize = CONFIG.pageSizes.includes(size) ? size : CONFIG.pageSize;
    state.page = 1;
    commit();
  });

  document.getElementById("filters").addEventListener("click", onFiltersClick);
  document.getElementById("filters").addEventListener("change", onFiltersChange);
  document.getElementById("filters").addEventListener("input", onFiltersSearch);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".filter")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });

  const head = document.getElementById("table-head");
  head.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-sort]");
    if (!button) return;
    toggleSort(button.dataset.sort);
  });

  const body = document.getElementById("table-body");
  body.addEventListener("click", onTableClick);
  body.addEventListener("change", onReadChange);
  bindObjetoTip();
  body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest(".js-expand, .js-read, .read-check")) return;
    const row = event.target.closest("tr[data-id]");
    if (!row) return;
    event.preventDefault();
    openModal(row.dataset.id);
  });

  document.getElementById("pagination").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button || button.disabled) return;
    const value = button.dataset.page;
    if (value === "prev") state.page -= 1;
    else if (value === "next") state.page += 1;
    else state.page = Number(value);
    commit();
  });

  document.getElementById("active-filters").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-clear]");
    if (!button) return;
    clearChip(button.dataset.clear, button.dataset.value || "");
  });

  window.addEventListener("hashchange", () => {
    readHash();
    if (document.activeElement !== ui.search) ui.search.value = state.filters.q;
    ui.pageSize.value = String(state.pageSize);
    render();
  });

  window.addEventListener("beforeprint", () => {
    state.printing = true;
    renderTable(currentView());
  });
  window.addEventListener("afterprint", () => {
    state.printing = false;
    render();
  });

  document.querySelectorAll(".logo").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
      const fallback = document.createElement("span");
      fallback.className = "logo-fallback";
      fallback.textContent = image.classList.contains("logo-set") ? "SET" : "IDT";
      image.after(fallback);
    });
  });
}

async function reload() {
  if (state.rows.length) renderTable(currentView());
  ui.refresh.disabled = true;
  ui.updated.textContent = "Atualizando a planilha…";
  const result = await Data.load();
  state.rows = result.rows;
  state.meta = result;
  buildFilterOptions();
  render();
  showStatus(result);
  paintMeeting();
  ui.refresh.disabled = false;
}

function showStatus(result) {
  if (!result.rows.length) {
    ui.updated.textContent = "Sem dados";
    ui.updated.classList.add("is-stale");
    ui.banner.hidden = false;
    ui.banner.classList.add("is-error");
    ui.banner.textContent = result.error
      ? `${result.error} Se o arquivo foi aberto direto do computador, use um servidor local — o navegador bloqueia a leitura da planilha em file://.`
      : "Não foi possível carregar a planilha.";
    return;
  }
  const when = Data.formatDateTime(result.fetchedAt);
  if (result.fromCache) {
    ui.updated.textContent = `Cópia local de ${when}`;
    ui.updated.classList.add("is-stale");
    ui.banner.hidden = false;
    ui.banner.classList.remove("is-error");
    ui.banner.textContent = `Sem conexão com a planilha (${result.error}). Exibindo a cópia salva em ${when}.`;
    return;
  }
  ui.updated.textContent = `Atualizado em ${when}`;
  ui.updated.classList.remove("is-stale");
  ui.banner.hidden = true;
  ui.banner.textContent = "";
}

function dim(row, key) {
  return Data.fieldLabel(row[key], key);
}

function matchRow(row, except) {
  const skip = new Set(except || []);
  if (!skip.has("q") && state.filters.q) {
    const blob = [row.nup, row.objeto, row.contrato, row.contratada, row.orgao, row.gestor, row.fiscal]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    if (!blob.includes(state.filters.q.toLocaleLowerCase("pt-BR"))) return false;
  }
  for (const filter of FILTERS) {
    if (skip.has(filter.key)) continue;
    const selected = state.filters[filter.key];
    if (selected.length && !selected.includes(dim(row, filter.key))) return false;
  }
  if (!skip.has("alerta") && state.filters.alerta) {
    if (!Data.isExpiring(row, Number(state.filters.alerta))) return false;
  }
  if (!skip.has("vencidos") && state.filters.vencidos && row.situacao !== "VENCIDO") return false;
  if (!skip.has("mes") && state.filters.mes) {
    if (Data.monthKey(row.terminoEfetivo) !== state.filters.mes) return false;
  }
  return true;
}

function selectExcept(keys) {
  return state.rows.filter((row) => matchRow(row, keys));
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function compare(a, b, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  const left = a[key];
  const right = b[key];
  const leftEmpty = left == null || left === "";
  const rightEmpty = right == null || right === "";
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * mul;
  return String(left).localeCompare(String(right), "pt-BR", { numeric: true, sensitivity: "base" }) * mul;
}

function currentView() {
  const filtered = selectExcept([]);
  const sorted = filtered.slice().sort((a, b) => compare(a, b, state.sort.key, state.sort.dir) || compare(a, b, "valorTotal", "desc"));
  const pages = Math.max(1, Math.ceil(sorted.length / state.pageSize) || 1);
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * state.pageSize;
  return { filtered, sorted, pages, pageRows: sorted.slice(start, start + state.pageSize) };
}

function render() {
  const pageBefore = state.page;
  const view = currentView();
  const totals = {
    valor: sum(view.filtered, "valorTotal"),
    tesouro: sum(view.filtered, "tesouro"),
    outras: sum(view.filtered, "outrasFontes"),
    empenhado: sum(view.filtered, "empenhado"),
    saldo: sum(view.filtered, "saldo"),
  };
  renderKpis(view.filtered, totals);
  renderAlerts();
  renderChips();
  renderFilterState();
  renderHead();
  Charts.render({
    gestorRows: selectExcept(["gestor"]),
    fiscalRows: selectExcept(["fiscal"]),
    categoriaRows: selectExcept(["categoria"]),
    timelineRows: selectExcept(["mes"]),
    empenhado: totals.empenhado,
    valorTotal: totals.valor,
    selected: state.filters,
    onDim: toggleDim,
    onMonth: toggleMes,
  });
  renderTable(view);
  renderPagination(view);
  if (state.page !== pageBefore) writeHash();
  document.body.dataset.ready = "1";
  document.body.dataset.count = String(state.rows.length);
  document.body.dataset.filtered = String(view.filtered.length);
  document.body.dataset.valor = String(Math.round(sum(state.rows, "valorTotal") * 100) / 100);
}

function renderKpis(rows, totals) {
  const ativos = rows.filter((row) => row.situacao === "ATIVO").length;
  const vencidosNaFaixa = rows.filter((row) => row.situacao === "VENCIDO").length;
  const outras = rows.length - ativos - vencidosNaFaixa;
  const vencidos = selectExcept(["vencidos"]).filter((row) => row.situacao === "VENCIDO").length;
  setAnimated(ui.count, rows.length, (value) => Data.formatNumber(value));
  const parts = [`${Data.formatNumber(ativos)} ativos`, `${Data.formatNumber(vencidosNaFaixa)} vencidos`];
  if (outras > 0) parts.push(`${Data.formatNumber(outras)} outras`);
  ui.countHint.textContent = rows.length ? parts.join(" · ") : "Nenhum contrato no recorte";

  const valorEl = document.getElementById("kpi-valor");
  valorEl.title = Data.formatMoney(totals.valor);
  setAnimated(valorEl, totals.valor, Data.formatCompact);
  const fontes = totals.tesouro + totals.outras;
  const tesouroPct = fontes ? totals.tesouro / fontes : 0;
  const outrasPct = fontes ? totals.outras / fontes : 0;
  document.getElementById("bar-tesouro").style.width = `${tesouroPct * 100}%`;
  document.getElementById("bar-outras").style.width = `${outrasPct * 100}%`;
  document.getElementById("stack-fontes").title = `Tesouro ${Data.formatMoney(totals.tesouro)} · Outras fontes ${Data.formatMoney(totals.outras)}`;
  document.getElementById("kpi-fontes").textContent = fontes
    ? `Tesouro ${Data.formatPercent(tesouroPct, 1)} · Outras fontes ${Data.formatPercent(outrasPct, 1)}`
    : "Sem fontes informadas";

  const execRatio = totals.valor > 0 ? totals.empenhado / totals.valor : 0;
  const execEl = document.getElementById("kpi-exec");
  execEl.title = `Empenhado ${Data.formatMoney(totals.empenhado)}`;
  setAnimated(execEl, execRatio * 100, (value) => Data.formatPercent(value / 100, 1));
  document.getElementById("bar-exec").style.width = `${Math.max(0, Math.min(100, execRatio * 100))}%`;
  const saldoEl = document.getElementById("kpi-saldo");
  saldoEl.textContent = `Empenhado ${Data.formatCompact(totals.empenhado)} · saldo ${Data.formatCompact(totals.saldo)}`;
  saldoEl.title = `Empenhado ${Data.formatMoney(totals.empenhado)} · Saldo ${Data.formatMoney(totals.saldo)}`;

  fillMoney("kpi-valor-cheio", totals.valor);
  fillMoney("kpi-tesouro", totals.tesouro);
  fillMoney("kpi-outras", totals.outras);
  fillMoney("kpi-empenhado", totals.empenhado);
  fillMoney("kpi-saldo-cheio", totals.saldo);

  setAnimated(document.getElementById("kpi-vencidos-num"), vencidos, (value) => Data.formatNumber(value));
  const vencidosBtn = document.getElementById("kpi-vencidos");
  vencidosBtn.classList.toggle("is-on", state.filters.vencidos);
  vencidosBtn.setAttribute("aria-pressed", state.filters.vencidos ? "true" : "false");
  document.getElementById("kpi-vencidos-meta").textContent = state.filters.vencidos ? "Filtro ativo" : "Clique para filtrar";
}

function fillMoney(id, value) {
  const element = document.getElementById(id);
  element.title = Data.formatMoney(value);
  setAnimated(element, value, Data.formatMoney);
}

function setAnimated(element, value, format) {
  const next = String(Math.round(Number(value) * 100) / 100);
  if (element.dataset.value === next) {
    element.textContent = format(Number(value) || 0);
    return;
  }
  const from = Number(element.dataset.value || 0);
  const to = Number(value) || 0;
  element.dataset.value = next;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = format(to);
    return;
  }
  const start = performance.now();
  const duration = 650;
  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(frame);
    else element.textContent = format(to);
  }
  requestAnimationFrame(frame);
}

function renderAlerts() {
  const base = selectExcept(["alerta"]);
  const critico = base.filter((row) => Data.isExpiring(row, CONFIG.alertaCritico)).length;
  const atencao = base.filter((row) => Data.isExpiring(row, CONFIG.alertaAtencao)).length;
  setAnimated(document.getElementById("alert-45-num"), critico, (value) => Data.formatNumber(value));
  setAnimated(document.getElementById("alert-100-num"), atencao, (value) => Data.formatNumber(value));
  document.querySelectorAll("[data-alerta]").forEach((button) => {
    const on = state.filters.alerta === button.dataset.alerta;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function renderChips() {
  const host = document.getElementById("active-filters");
  const chips = [];
  if (state.filters.q) chips.push({ clear: "q", label: `Busca: ${state.filters.q}` });
  FILTERS.forEach((filter) => {
    state.filters[filter.key].forEach((value) => {
      chips.push({ clear: filter.key, value, label: `${filter.label}: ${value}` });
    });
  });
  if (state.filters.alerta) chips.push({ clear: "alerta", label: `Vencendo em menos de ${state.filters.alerta} dias` });
  if (state.filters.vencidos) chips.push({ clear: "vencidos", label: "Vencidos" });
  if (state.filters.mes) chips.push({ clear: "mes", label: `Vencimento: ${Charts.monthLabel(state.filters.mes)}` });
  host.hidden = chips.length === 0;
  host.innerHTML = chips
    .map((chip) => `<span class="chip">${esc(chip.label)}<button type="button" data-clear="${esc(chip.clear)}" data-value="${esc(chip.value || "")}" aria-label="Remover filtro ${esc(chip.label)}">×</button></span>`)
    .join("");
}

function clearChip(key, value) {
  if (key === "q") {
    state.filters.q = "";
    ui.search.value = "";
  } else if (key === "alerta") state.filters.alerta = null;
  else if (key === "vencidos") state.filters.vencidos = false;
  else if (key === "mes") state.filters.mes = null;
  else state.filters[key] = state.filters[key].filter((item) => item !== value);
  state.page = 1;
  commit();
}

function buildFilterOptions() {
  FILTERS.forEach((filter) => {
    const menu = document.querySelector(`.filter[data-key="${filter.key}"] .filter-options`);
    if (!menu) return;
    const values = [...new Set(state.rows.map((row) => dim(row, filter.key)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    menu.innerHTML = values
      .map((value) => `<label><input type="checkbox" value="${esc(value)}" /><span>${esc(value)}</span></label>`)
      .join("");
  });
}

function renderFilterState() {
  FILTERS.forEach((filter) => {
    const wrap = document.querySelector(`.filter[data-key="${filter.key}"]`);
    if (!wrap) return;
    const selected = state.filters[filter.key];
    const label = wrap.querySelector(".filter-label");
    label.textContent = !selected.length ? filter.label : selected.length === 1 ? selected[0] : `${filter.label} (${selected.length})`;
    label.title = label.textContent;
    wrap.classList.toggle("is-on", selected.length > 0);
    wrap.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = selected.includes(input.value);
    });
  });
}

function onFiltersClick(event) {
  const clear = event.target.closest(".js-clear-dim");
  if (clear) {
    const key = clear.closest(".filter").dataset.key;
    state.filters[key] = [];
    state.page = 1;
    commit();
    return;
  }
  const button = event.target.closest(".filter-btn");
  if (!button) return;
  const wrap = button.closest(".filter");
  const menu = wrap.querySelector(".filter-menu");
  const willOpen = menu.hidden;
  closeMenus();
  if (willOpen) {
    menu.hidden = false;
    wrap.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    const search = menu.querySelector(".filter-search");
    if (search) search.focus();
  }
}

function onFiltersChange(event) {
  const input = event.target;
  if (input.type !== "checkbox") return;
  const key = input.closest(".filter").dataset.key;
  const menu = input.closest(".filter-menu");
  state.filters[key] = [...menu.querySelectorAll("input:checked")].map((item) => item.value);
  state.page = 1;
  commit();
}

function onFiltersSearch(event) {
  const input = event.target;
  if (!input.classList.contains("filter-search")) return;
  const query = input.value.trim().toLocaleLowerCase("pt-BR");
  input.closest(".filter-menu").querySelectorAll("label").forEach((label) => {
    label.hidden = Boolean(query) && !label.textContent.toLocaleLowerCase("pt-BR").includes(query);
  });
}

function closeMenus() {
  document.querySelectorAll(".filter").forEach((wrap) => {
    wrap.classList.remove("is-open");
    const button = wrap.querySelector(".filter-btn");
    const menu = wrap.querySelector(".filter-menu");
    if (button) button.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  });
}

function toggleDim(key, names) {
  const current = state.filters[key];
  const same = current.length === names.length && names.every((name) => current.includes(name));
  state.filters[key] = same ? [] : names.slice();
  state.page = 1;
  commit();
}

function toggleAlerta(value) {
  state.filters.alerta = state.filters.alerta === value ? null : value;
  state.page = 1;
  commit();
}

function toggleVencidos() {
  state.filters.vencidos = !state.filters.vencidos;
  state.page = 1;
  commit();
}

function toggleMes(key) {
  state.filters.mes = state.filters.mes === key ? null : key;
  state.page = 1;
  commit();
}

function toggleSort(key) {
  if (!SORTABLE.has(key)) return;
  if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
  else {
    state.sort.key = key;
    state.sort.dir = DESC_FIRST.has(key) ? "desc" : "asc";
  }
  state.page = 1;
  commit();
}

function resetFilters() {
  state.filters = emptyFilters();
  state.sort = { key: "diasRestantes", dir: "asc" };
  state.page = 1;
  state.pageSize = CONFIG.pageSize;
  ui.search.value = "";
  ui.pageSize.value = String(CONFIG.pageSize);
  closeMenus();
  commit();
}

function commit() {
  writeHash();
  render();
}

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const filters = emptyFilters();
  filters.q = params.get("q") || "";
  FILTERS.forEach((filter) => {
    filters[filter.key] = params.getAll(filter.key).filter(Boolean);
  });
  const alerta = params.get("alerta");
  filters.alerta = alerta === String(CONFIG.alertaCritico) || alerta === String(CONFIG.alertaAtencao) ? alerta : null;
  filters.vencidos = params.get("vencidos") === "1";
  const mes = params.get("mes");
  filters.mes = /^\d{4}-\d{2}$/.test(mes || "") ? mes : null;
  state.filters = filters;
  const sort = params.get("sort");
  state.sort.key = SORTABLE.has(sort) ? sort : "diasRestantes";
  state.sort.dir = params.get("dir") === "desc" ? "desc" : "asc";
  const page = Number(params.get("page"));
  state.page = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const size = Number(params.get("size"));
  state.pageSize = CONFIG.pageSizes.includes(size) ? size : CONFIG.pageSize;
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set("q", state.filters.q);
  FILTERS.forEach((filter) => {
    state.filters[filter.key].forEach((value) => params.append(filter.key, value));
  });
  if (state.filters.alerta) params.set("alerta", state.filters.alerta);
  if (state.filters.vencidos) params.set("vencidos", "1");
  if (state.filters.mes) params.set("mes", state.filters.mes);
  if (state.sort.key !== "diasRestantes" || state.sort.dir !== "asc") {
    params.set("sort", state.sort.key);
    params.set("dir", state.sort.dir);
  }
  if (state.page > 1) params.set("page", String(state.page));
  if (state.pageSize !== CONFIG.pageSize) params.set("size", String(state.pageSize));
  const next = params.toString();
  const url = next ? `${location.pathname}${location.search}#${next}` : `${location.pathname}${location.search}`;
  if (`${location.pathname}${location.search}${location.hash}` !== url) history.replaceState(null, "", url);
}

function renderHead() {
  const check = `<th class="col-check" scope="col"><span class="check-head">Lido</span></th>`;
  document.getElementById("table-head").innerHTML = check + COLUMNS.map((column) => {
    const sort = state.sort.key === column.key ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none";
    return `<th class="${column.numeric ? "num" : ""}" aria-sort="${sort}"><button type="button" data-sort="${column.key}">${column.label}</button></th>`;
  }).join("");
}

function tone(row) {
  if (row.situacao === "VENCIDO" || (row.diasRestantes != null && row.diasRestantes < CONFIG.alertaCritico)) return "danger";
  if (row.diasRestantes != null && row.diasRestantes < CONFIG.alertaAtencao) return "warn";
  return "";
}

function situacaoClass(value) {
  if (value === "ATIVO") return "badge-ok";
  if (value === "VENCIDO") return "badge-danger";
  if (value.includes("SUSP") || value.includes("RESC")) return "badge-warn";
  return "badge-blue";
}

function diasClass(row) {
  if (row.diasRestantes == null) return "badge-muted";
  if (row.diasRestantes < CONFIG.alertaCritico) return "badge-danger";
  if (row.diasRestantes < CONFIG.alertaAtencao) return "badge-warn";
  return "badge-ok";
}

function renderTable(view) {
  const body = document.getElementById("table-body");
  const count = document.getElementById("result-count");
  const sorted = view.sorted;
  const rows = state.printing ? sorted : view.pageRows;
  if (!sorted.length) {
    count.textContent = state.rows.length ? "Nenhum contrato encontrado com os filtros atuais." : "Nenhum contrato carregado.";
    body.innerHTML = `<tr><td class="empty-cell" colspan="${COLUMNS.length + 1}">${
      state.rows.length
        ? 'Nenhum contrato encontrado.<br><button type="button" class="btn-ghost btn-small" id="empty-reset">Limpar filtros</button>'
        : "A planilha ainda não trouxe contratos."
    }</td></tr>`;
    const reset = document.getElementById("empty-reset");
    if (reset) reset.addEventListener("click", resetFilters);
    return;
  }
  const from = state.printing ? 1 : (state.page - 1) * state.pageSize + 1;
  const to = state.printing ? sorted.length : from + rows.length - 1;
  const noun = sorted.length === 1 ? "contrato" : "contratos";
  let text = `${Data.formatNumber(sorted.length)} ${noun}`;
  if (sorted.length !== state.rows.length) text += ` de ${Data.formatNumber(state.rows.length)}`;
  text += state.printing ? " · visão para impressão" : ` · exibindo ${Data.formatNumber(from)}–${Data.formatNumber(to)}`;
  count.textContent = `${text}. Clique em uma linha para ver o contrato.`;
  body.innerHTML = rows.map(rowHtml).join("");
  markLongObjects();
  paintMeeting();
}

function rowHtml(row) {
  const level = tone(row);
  const label = `Ver detalhes do contrato ${row.contrato || row.nup || row.objeto}`;
  const read = state.meeting.checks.has(row.id) ? " is-read" : "";
  return `<tr class="${level ? `row-${level}` : ""}${read}" data-id="${esc(row.id)}" tabindex="0" aria-label="${esc(label)}">
    <td class="col-check" data-label="Lido">${checkCell(row)}</td>
    <td class="col-objeto" data-label="Objeto">${objetoCell(row)}</td>
    <td data-label="Órgão"><span class="ellipsis" title="${esc(dim(row, "orgao"))}">${esc(dim(row, "orgao"))}</span></td>
    <td data-label="Contratada"><span class="ellipsis" title="${esc(dim(row, "contratada"))}">${esc(dim(row, "contratada"))}</span></td>
    <td data-label="Execução">${execCell(row)}</td>
    <td data-label="Contrato">${esc(row.contrato || Data.VAZIO)}</td>
    ${moneyCell(row.valorTotal, "Valor total")}
    ${moneyCell(row.saldo, "Saldo")}
    <td data-label="Término">${terminoCell(row)}</td>
    <td data-label="Dias restantes">${diasCell(row)}</td>
    <td data-label="Categoria"><span class="ellipsis" title="${esc(dim(row, "categoria"))}">${esc(dim(row, "categoria"))}</span></td>
    <td data-label="Situação"><span class="badge ${situacaoClass(row.situacao)}">${esc(dim(row, "situacao"))}</span></td>
  </tr>`;
}

function objetoCell(row) {
  const text = row.objeto || Data.VAZIO;
  return `<div class="objeto-wrap"><p class="objeto-text" id="obj-${esc(row.id)}">${esc(text)}</p></div>`;
}

function checkCell(row) {
  const marked = state.meeting.checks.has(row.id);
  const stamp = state.meeting.checks.get(row.id);
  const time = !marked ? "" : stamp == null ? "lido" : formatDuration(stamp);
  return `<label class="read-check"><input type="checkbox" class="js-read" data-id="${esc(row.id)}" ${marked ? "checked" : ""} aria-label="Marcar como lido na reunião" /><span class="read-time">${esc(time)}</span></label>`;
}

function markLongObjects() {
  document.querySelectorAll("#table-body .objeto-text").forEach((paragraph) => {
    const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight) || 20;
    if (paragraph.scrollHeight <= paragraph.clientHeight + lineHeight * 0.6) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linkish js-expand";
    button.setAttribute("aria-expanded", "false");
    button.dataset.target = paragraph.id;
    button.textContent = "Mais";
    paragraph.after(button);
  });
}

function execCell(row) {
  if (row.execucao == null) return Data.VAZIO;
  const width = Math.max(0, Math.min(100, row.execucao * 100));
  const over = row.execucao > 1 ? " is-over" : "";
  return `<div class="exec" title="${esc(Data.formatPercent(row.execucao))}"><div class="exec-bar${over}"><span style="width:${width}%"></span></div><span class="exec-label">${esc(Data.formatPercent(row.execucao))}</span></div>`;
}

function terminoCell(row) {
  const efetivo = Data.formatDate(row.terminoEfetivo);
  if (row.aditivoPrazo && row.aditivoPrazo !== row.termino) {
    return `${esc(efetivo)}<span class="addon" title="Término original ${esc(Data.formatDate(row.termino))}">aditivo</span>`;
  }
  return esc(efetivo);
}

function moneyCell(value, label) {
  const full = Data.formatMoney(value);
  return `<td class="num ${value < 0 ? "neg" : ""}" data-label="${esc(label)}" title="${esc(full)}">${esc(Data.formatCompact(value))}</td>`;
}

function diasCell(row) {
  const title = row.diasPlanilha == null ? "" : `Valor na planilha: ${row.diasPlanilha}`;
  let text = Data.VAZIO;
  if (row.diasRestantes != null && row.diasRestantes < 0) text = `vencido há ${Data.formatNumber(Math.abs(row.diasRestantes))} d`;
  else if (row.diasRestantes != null) text = Data.formatNumber(row.diasRestantes);
  const toneName = diasClass(row).replace("badge-", "dias-");
  return `<span class="dias ${toneName}" title="${esc(title)}">${esc(text)}</span>`;
}

function onTableClick(event) {
  if (event.target.closest(".col-check")) {
    event.stopPropagation();
    return;
  }
  const more = event.target.closest(".js-expand");
  if (more) {
    event.stopPropagation();
    const paragraph = document.getElementById(more.dataset.target);
    const open = paragraph.classList.toggle("is-open");
    more.textContent = open ? "Menos" : "Mais";
    more.setAttribute("aria-expanded", open ? "true" : "false");
    return;
  }
  const tableRow = event.target.closest("tr[data-id]");
  if (tableRow) openModal(tableRow.dataset.id);
}

function onReadChange(event) {
  const box = event.target.closest(".js-read");
  if (!box) return;
  toggleRead(box.dataset.id, box.checked);
}

function toggleRead(id, checked) {
  if (checked && !state.meeting.startedAt) startMeeting();
  if (checked) state.meeting.checks.set(id, meetingElapsed());
  else state.meeting.checks.delete(id);
  const row = document.querySelector(`#table-body tr[data-id="${CSS.escape(id)}"]`);
  if (row) {
    row.classList.toggle("is-read", checked);
    const time = row.querySelector(".read-time");
    const stamp = state.meeting.checks.get(id);
    if (time) time.textContent = !checked ? "" : stamp == null ? "lido" : formatDuration(stamp);
  }
  paintMeeting();
}

function horaRelogio(ms) {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function saveMeeting() {
  const { startedAt, endedAt, inicio, fim } = state.meeting;
  if (!startedAt) {
    sessionStorage.removeItem("set-reuniao");
    return;
  }
  sessionStorage.setItem("set-reuniao", JSON.stringify({ startedAt, endedAt, inicio, fim }));
}

function restoreMeeting() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("set-reuniao") || "null");
    if (!saved || !saved.startedAt) return;
    state.meeting.startedAt = saved.startedAt;
    state.meeting.endedAt = saved.endedAt || null;
    state.meeting.inicio = saved.inicio || horaRelogio(saved.startedAt);
    state.meeting.fim = saved.fim || "";
    if (!state.meeting.endedAt) {
      state.meeting.timer = window.setInterval(() => {
        ui.clock.textContent = formatDuration(meetingElapsed());
      }, 250);
    }
    paintMeeting();
  } catch (error) {
    sessionStorage.removeItem("set-reuniao");
  }
}

function avisarAta() {
  if (typeof Ata !== "undefined" && Ata.atualizarHorarios) Ata.atualizarHorarios();
}

function startMeeting() {
  if (state.meeting.startedAt && !state.meeting.endedAt) return;
  if (state.meeting.endedAt) {
    state.meeting.checks = new Map();
    if (state.rows.length) renderTable(currentView());
  }
  if (state.meeting.timer) window.clearInterval(state.meeting.timer);
  const now = Date.now();
  state.meeting.startedAt = now;
  state.meeting.endedAt = null;
  state.meeting.inicio = horaRelogio(now);
  state.meeting.fim = "";
  saveMeeting();
  paintMeeting();
  state.meeting.timer = window.setInterval(() => {
    ui.clock.textContent = formatDuration(meetingElapsed());
  }, 250);
  avisarAta();
}

function endMeeting() {
  if (!state.meeting.startedAt || state.meeting.endedAt) return;
  state.meeting.endedAt = Date.now();
  state.meeting.fim = horaRelogio(state.meeting.endedAt);
  if (state.meeting.timer) window.clearInterval(state.meeting.timer);
  state.meeting.timer = null;
  saveMeeting();
  paintMeeting();
  avisarAta();
}

function resetMeeting() {
  if (state.meeting.timer) window.clearInterval(state.meeting.timer);
  state.meeting.startedAt = null;
  state.meeting.endedAt = null;
  state.meeting.inicio = "";
  state.meeting.fim = "";
  state.meeting.timer = null;
  state.meeting.checks = new Map();
  saveMeeting();
  if (ui.clock) paintMeeting();
}

function meetingElapsed() {
  if (!state.meeting.startedAt) return null;
  return (state.meeting.endedAt || Date.now()) - state.meeting.startedAt;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function paintMeeting() {
  if (!ui.clock) return;
  const elapsed = meetingElapsed();
  ui.clock.textContent = elapsed == null ? "00:00:00" : formatDuration(elapsed);
  const visible = state.rows.length ? selectExcept([]) : [];
  const read = visible.filter((row) => state.meeting.checks.has(row.id)).length;
  ui.meetingRead.textContent = visible.length
    ? `${Data.formatNumber(read)} de ${Data.formatNumber(visible.length)} lidos`
    : "0 lidos";
  const on = state.meeting.startedAt != null && !state.meeting.endedAt;
  ui.meeting.classList.toggle("is-on", state.meeting.startedAt != null);
  ui.meetingBtn.textContent = on ? "Em andamento" : "Iniciar reunião";
  ui.meetingBtn.disabled = on;
  ui.meetingBtn.setAttribute("aria-pressed", on ? "true" : "false");
  if (ui.meetingEnd) ui.meetingEnd.hidden = !on;
}

function bindObjetoTip() {
  const tip = document.createElement("div");
  tip.id = "objeto-tip";
  tip.className = "objeto-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.appendChild(tip);
  ui.tip = tip;
  const body = document.getElementById("table-body");
  body.addEventListener("mouseover", (event) => {
    const cell = event.target.closest(".col-objeto");
    if (!cell) return;
    const paragraph = cell.querySelector(".objeto-text");
    if (paragraph) showObjetoTip(paragraph);
  });
  body.addEventListener("mouseout", (event) => {
    const cell = event.target.closest(".col-objeto");
    if (!cell) return;
    const next = event.relatedTarget;
    if (next && cell.contains(next)) return;
    hideObjetoTip();
  });
  document.querySelector(".table-scroll").addEventListener("scroll", hideObjetoTip);
}

function showObjetoTip(paragraph) {
  const tip = ui.tip;
  tip.textContent = paragraph.textContent;
  tip.hidden = false;
  const rect = paragraph.getBoundingClientRect();
  const maxWidth = Math.min(480, window.innerWidth - 24);
  tip.style.maxWidth = `${maxWidth}px`;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (left < 12) left = 12;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideObjetoTip() {
  if (ui.tip) ui.tip.hidden = true;
}

function renderPagination(view) {
  const nav = document.getElementById("pagination");
  if (state.printing || view.pages <= 1) {
    nav.innerHTML = "";
    return;
  }
  const buttons = [`<button type="button" data-page="prev" ${state.page <= 1 ? "disabled" : ""}>Anterior</button>`];
  let start = Math.max(1, state.page - 3);
  let end = Math.min(view.pages, start + 6);
  start = Math.max(1, end - 6);
  if (start > 1) buttons.push('<span class="gap">…</span>');
  for (let page = start; page <= end; page += 1) {
    buttons.push(`<button type="button" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ""}>${page}</button>`);
  }
  if (end < view.pages) buttons.push('<span class="gap">…</span>');
  buttons.push(`<button type="button" data-page="next" ${state.page >= view.pages ? "disabled" : ""}>Próxima</button>`);
  nav.innerHTML = buttons.join("");
}

function openModal(id) {
  const row = state.rows.find((item) => item.id === id);
  if (!row) return;
  state.lastFocus = document.activeElement;
  document.getElementById("modal-kicker").textContent = row.nup || "Contrato";
  document.getElementById("modal-title").textContent = row.contrato ? `Contrato ${row.contrato}` : "Contrato sem número";
  document.getElementById("modal-sub").textContent = [dim(row, "contratada"), dim(row, "orgao")].join(" · ");
  document.getElementById("modal-body").innerHTML = modalHtml(row);
  if (!ui.modal.open) ui.modal.showModal();
  document.getElementById("modal-close").focus();
}

function modalHtml(row) {
  const diffFontes = Math.abs(row.tesouro + row.outrasFontes - (row.valorOriginal + row.aditivoValor));
  const note = diffFontes > 1
    ? `<p class="quality-note">Tesouro + outras fontes e valor original + aditivo diferem em ${esc(Data.formatMoney(diffFontes))}.</p>`
    : "";
  return `
    <div class="modal-badges">
      <span class="badge ${situacaoClass(row.situacao)}">${esc(dim(row, "situacao"))}</span>
      <span class="badge ${diasClass(row)}">${row.diasRestantes == null ? "Sem prazo" : `${esc(Data.formatNumber(row.diasRestantes))} dias`}</span>
    </div>
    <p class="modal-objeto">${esc(row.objeto || "Objeto não informado.")}</p>
    ${vigenciaHtml(row)}
    <div class="detail-grid">
      ${block("Identificação", [
        ["NUP", row.nup],
        ["Órgão", dim(row, "orgao")],
        ["Contratada", dim(row, "contratada")],
        ["Categoria", dim(row, "categoria")],
        ["Tipo", dim(row, "tipo")],
        ["Modalidade", dim(row, "modalidade")],
        ["Nº SACC", row.sacc],
        ["Contrato", row.contrato],
        ["MAPP", row.mapp],
        ["Pré-reserva", row.preReserva],
      ])}
      ${block("Vigência", [
        ["Início", Data.formatDateLong(row.inicio)],
        ["Término", Data.formatDateLong(row.termino)],
        ["Aditivo de prazo", Data.formatDateLong(row.aditivoPrazo)],
        ["Término efetivo", Data.formatDateLong(row.terminoEfetivo)],
        ["Dias restantes", row.diasRestantes == null ? Data.VAZIO : Data.formatNumber(row.diasRestantes)],
        ["Dias na planilha", row.diasPlanilha == null ? Data.VAZIO : Data.formatNumber(row.diasPlanilha)],
      ])}
      ${block("Valores", [
        ["Valor original", Data.formatMoney(row.valorOriginal)],
        ["Aditivo de valor", Data.formatMoney(row.aditivoValor)],
        ["Valor total", Data.formatMoney(row.valorTotal)],
        ["Tesouro", Data.formatMoney(row.tesouro)],
        ["Outras fontes", Data.formatMoney(row.outrasFontes)],
        ["Empenhado", Data.formatMoney(row.empenhado)],
        ["Saldo", Data.formatMoney(row.saldo)],
        ["Pago", row.pago == null ? Data.VAZIO : Data.formatMoney(row.pago)],
        ["Saldo real", row.saldoReal == null ? Data.VAZIO : Data.formatMoney(row.saldoReal)],
        ["Execução", Data.formatPercent(row.execucao)],
      ])}
      ${block("Responsáveis", [
        ["Gestor", dim(row, "gestor")],
        ["Fiscal", dim(row, "fiscal")],
      ])}
    </div>
    ${note}`;
}

function block(title, pairs) {
  return `<section class="detail-block"><h3>${esc(title)}</h3><dl>${pairs
    .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value || Data.VAZIO)}</dd>`)
    .join("")}</dl></section>`;
}

function vigenciaHtml(row) {
  if (!row.inicio || !row.terminoEfetivo) return "";
  const start = new Date(`${row.inicio}T00:00:00`);
  const end = new Date(`${row.terminoEfetivo}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const span = end - start;
  const ratio = span > 0 ? (today - start) / span : 1;
  const width = Math.max(0, Math.min(100, ratio * 100));
  const over = ratio > 1;
  const marker = Math.max(0, Math.min(100, ratio * 100));
  return `<div class="vigencia-wrap">
    <div class="vigencia" aria-hidden="true">
      <div class="vigencia-fill${over ? " is-over" : ""}" style="width:${width}%"></div>
      <div class="vigencia-today" style="left:${marker}%"></div>
    </div>
    <div class="vigencia-scale">
      <span>Início ${esc(Data.formatDate(row.inicio))}</span>
      <span>Hoje</span>
      <span>Término ${esc(Data.formatDate(row.terminoEfetivo))}</span>
    </div>
  </div>`;
}

function exportRows() {
  return currentView().sorted;
}

function exportRecords(rows) {
  return rows.map((row) => ({
    NUP: row.nup,
    Órgão: row.orgao,
    Contratada: row.contratada,
    Contrato: row.contrato,
    Categoria: row.categoria,
    Tipo: row.tipo,
    Modalidade: row.modalidade,
    Situação: row.situacao,
    Objeto: row.objeto,
    Gestor: row.gestor,
    Fiscal: row.fiscal,
    MAPP: row.mapp,
    "Nº SACC": row.sacc,
    "Pré-reserva": row.preReserva,
    Início: Data.formatDate(row.inicio),
    Término: Data.formatDate(row.termino),
    "Aditivo de prazo": Data.formatDate(row.aditivoPrazo),
    "Término efetivo": Data.formatDate(row.terminoEfetivo),
    "Dias restantes": row.diasRestantes,
    "Valor original": row.valorOriginal,
    "Aditivo de valor": row.aditivoValor,
    Tesouro: row.tesouro,
    "Outras fontes": row.outrasFontes,
    "Valor total": row.valorTotal,
    Empenhado: row.empenhado,
    Saldo: row.saldo,
    Pago: row.pago,
    "Saldo real": row.saldoReal,
    "Execução (%)": row.execucao == null ? null : Math.round(row.execucao * 10000) / 100,
  }));
}

function fileStamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function exportCsv() {
  const rows = exportRows();
  if (!rows.length) return;
  const records = exportRecords(rows);
  const headers = Object.keys(records[0]);
  const lines = [headers.join(";")];
  records.forEach((record) => {
    lines.push(headers.map((header) => csvField(csvValue(header, record[header]))).join(";"));
  });
  download(`contratos-set-${fileStamp()}.csv`, `\uFEFF${lines.join("\r\n")}`, "text/csv;charset=utf-8");
}

function csvValue(header, value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    const digits = header === "Dias restantes" ? 0 : 2;
    return value.toFixed(digits).replace(".", ",");
  }
  return value;
}

function csvField(value) {
  const text = String(value ?? "");
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportXlsx() {
  const rows = exportRows();
  if (!rows.length) return;
  if (typeof XLSX === "undefined") {
    ui.banner.hidden = false;
    ui.banner.classList.add("is-error");
    ui.banner.textContent = "A exportação para Excel não carregou. Use o CSV.";
    return;
  }
  const sheet = XLSX.utils.json_to_sheet(exportRecords(rows));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Contratos");
  XLSX.writeFile(book, `contratos-set-${fileStamp()}.xlsx`);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

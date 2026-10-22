/* Leitura, normalização e formatação da planilha publicada. */
const Data = (() => {
  const VAZIO = "—";
  const moneyFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function normalizeKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanName(value) {
    return cleanText(value).toLocaleUpperCase("pt-BR");
  }

  function parseMoney(value) {
    if (value == null) return 0;
    let text = String(value).trim();
    if (!text || text === "-" || text === "—" || text.startsWith("#")) return 0;
    text = text.replace(/R\$\s?/gi, "").replace(/\s/g, "");
    if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function parsePercent(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw || raw.startsWith("#") || raw === "-") return null;
    const hasPercent = raw.includes("%");
    const text = raw.replace("%", "").trim().replace(/\./g, "").replace(",", ".");
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    if (hasPercent || number > 1) return number / 100;
    return number;
  }

  function parseDate(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text === "0" || text === "-" || text.startsWith("#")) return null;
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!match) return null;
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const month = Number(match[2]);
    const day = Number(match[1]);
    if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseInteger(value) {
    if (value == null) return null;
    const text = String(value).trim().replace(/\./g, "");
    if (!text || text.startsWith("#")) return null;
    const number = Number(text.replace(",", "."));
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function daysFromToday(iso) {
    if (!iso) return null;
    const [year, month, day] = iso.split("-").map(Number);
    const target = Date.UTC(year, month - 1, day);
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function rowMap(row) {
    const map = new Map();
    Object.keys(row || {}).forEach((key) => {
      const normalized = normalizeKey(key);
      if (normalized && !map.has(normalized)) map.set(normalized, row[key]);
    });
    return map;
  }

  function pick(map, key) {
    if (map.has(key)) return map.get(key) ?? "";
    for (const [candidate, value] of map) {
      if (candidate.startsWith(key)) return value ?? "";
    }
    return "";
  }

  function normalize(records) {
    const rows = [];
    records.forEach((record, index) => {
      const map = rowMap(record);
      const nup = cleanText(pick(map, "nup")).replace(/\s+/g, "");
      const objeto = cleanText(pick(map, "objeto"));
      if (!nup && !objeto) return;

      const tesouro = parseMoney(pick(map, "tesouro"));
      const outrasFontes = parseMoney(pick(map, "outrasfontes"));
      const valorOriginal = parseMoney(pick(map, "valororiginal"));
      const aditivoValor = parseMoney(pick(map, "aditivovalor"));
      const empenhado = parseMoney(pick(map, "empenhado"));
      const saldo = parseMoney(pick(map, "saldo"));
      const pago = parseMoney(pick(map, "pago"));
      const saldoRealRaw = pick(map, "saldoreal");
      const saldoReal = cleanText(saldoRealRaw) ? parseMoney(saldoRealRaw) : null;

      let valorTotal = valorOriginal + aditivoValor;
      if (!valorTotal) valorTotal = tesouro + outrasFontes;

      const inicio = parseDate(pick(map, "inicio"));
      const termino = parseDate(pick(map, "termino"));
      const aditivoPrazo = parseDate(pick(map, "aditivodeprazo"));
      const terminoEfetivo = aditivoPrazo || termino;
      let diasRestantes = daysFromToday(terminoEfetivo);
      const diasPlanilha = parseInteger(pick(map, "diasrestantes"));
      if (diasRestantes == null) diasRestantes = diasPlanilha;

      let execucao = parsePercent(pick(map, "execucao"));
      if (execucao == null && valorTotal > 0) execucao = empenhado / valorTotal;

      const contrato = cleanText(pick(map, "contrato"));
      rows.push({
        id: `r${index}`,
        nup,
        orgao: cleanName(pick(map, "orgao")),
        preReserva: cleanText(pick(map, "prereserva")),
        objeto,
        contratada: cleanName(pick(map, "contratada")),
        categoria: cleanName(pick(map, "categoria")),
        tipo: cleanName(pick(map, "tipo")),
        modalidade: cleanName(pick(map, "modalidade")),
        sacc: cleanText(pick(map, "nsacc")),
        contrato,
        valorOriginal,
        aditivoValor,
        tesouro,
        outrasFontes,
        valorTotal,
        situacao: cleanName(pick(map, "situacao")),
        inicio,
        termino,
        aditivoPrazo,
        terminoEfetivo,
        diasRestantes,
        diasPlanilha,
        mapp: cleanText(pick(map, "mapp")),
        empenhado,
        saldo,
        gestor: cleanName(pick(map, "gestor")),
        fiscal: cleanName(pick(map, "fiscal")),
        execucao,
        pago: cleanText(pick(map, "pago")) ? pago : null,
        saldoReal,
      });
    });
    return rows;
  }

  function looksLikeSheet(csv) {
    const head = String(csv || "").replace(/^\uFEFF/, "").slice(0, 800).toUpperCase();
    return head.includes("NUP") && head.includes("OBJETO");
  }

  function parseCsv(csv) {
    if (typeof Papa === "undefined") throw new Error("PapaParse não carregou.");
    if (!looksLikeSheet(csv)) throw new Error("A resposta não é a planilha de contratos.");
    const parsed = Papa.parse(csv, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => String(header || "").trim(),
    });
    return normalize(parsed.data || []);
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CONFIG.cacheKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data.csv !== "string") return null;
      return data;
    } catch (error) {
      return null;
    }
  }

  function saveCache(csv) {
    try {
      localStorage.setItem(CONFIG.cacheKey, JSON.stringify({ savedAt: Date.now(), csv }));
    } catch (error) {
      /* navegador sem espaço ou storage bloqueado */
    }
  }

  let ultimoCsv = "";

  async function fetchCsv() {
    const join = CONFIG.csvUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${CONFIG.csvUrl}${join}t=${Date.now()}`, {
      cache: "reload",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`A planilha respondeu com o status ${response.status}.`);
    return response.text();
  }

  async function load() {
    try {
      const csv = await fetchCsv();
      const rows = parseCsv(csv);
      if (!rows.length) throw new Error("A planilha não retornou contratos.");
      const mudou = csv !== ultimoCsv;
      ultimoCsv = csv;
      saveCache(csv);
      return { rows, fetchedAt: new Date(), fromCache: false, error: null, mudou };
    } catch (error) {
      const cached = readCache();
      if (cached) {
        try {
          const rows = parseCsv(cached.csv);
          if (rows.length) {
            return {
              rows,
              fetchedAt: new Date(cached.savedAt),
              fromCache: true,
              error: error && error.message ? error.message : "Falha ao atualizar a planilha.",
            };
          }
        } catch (parseError) {
          /* cache inválido */
        }
      }
      return {
        rows: [],
        fetchedAt: null,
        fromCache: false,
        error: error && error.message ? error.message : "Falha ao carregar a planilha.",
      };
    }
  }

  function formatMoney(value) {
    return moneyFmt.format(Number(value) || 0);
  }

  function formatCompact(value) {
    const number = Number(value) || 0;
    const abs = Math.abs(number);
    const sign = number < 0 ? "-" : "";
    if (abs >= 1e9) {
      return `${sign}R$ ${(abs / 1e9).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bi`;
    }
    if (abs >= 1e6) {
      return `${sign}R$ ${(abs / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
    }
    if (abs >= 1e4) {
      return `${sign}R$ ${(abs / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
    }
    return formatMoney(number);
  }

  function formatPercent(value, digits = 2) {
    if (value == null || !Number.isFinite(value)) return VAZIO;
    return `${(value * 100).toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}%`;
  }

  function formatDate(iso) {
    if (!iso) return VAZIO;
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatDateLong(iso) {
    if (!iso) return VAZIO;
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  function formatDateTime(date) {
    if (!date) return "";
    const day = date.toLocaleDateString("pt-BR");
    const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${day} às ${time}`;
  }

  function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString("pt-BR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function isExpiring(row, days) {
    if (row.diasRestantes == null) return false;
    return row.diasRestantes >= 0 && row.diasRestantes < days;
  }

  function monthKey(iso) {
    return iso ? iso.slice(0, 7) : null;
  }

  function fieldLabel(value, key) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text && key === "fiscal") return "Sem fiscal designado";
    return text || VAZIO;
  }

  return {
    VAZIO,
    fieldLabel,
    load,
    parseCsv,
    normalize,
    formatMoney,
    formatCompact,
    formatPercent,
    formatDate,
    formatDateLong,
    formatDateTime,
    formatNumber,
    isExpiring,
    monthKey,
  };
})();

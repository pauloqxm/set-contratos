/* Aba Frequência: presenças da planilha do Comitê Executivo, por data. */
const Frequencia = (() => {
  let records = null;
  let error = "";
  let pending = null;
  let selected = "";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function norm(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("pt-BR");
  }

  function field(row, names) {
    const wanted = names.map(norm);
    const found = Object.keys(row).find((key) => wanted.includes(norm(key)));
    return found ? String(row[found] || "").replace(/\s+/g, " ").trim() : "";
  }

  function confirmou(value) {
    const text = norm(value);
    return text === "sim" || text.startsWith("sim ");
  }

  function parseStamp(value) {
    const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    return {
      data: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      hora: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    };
  }

  function parse(csv) {
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const people = [];
    parsed.data.forEach((row) => {
      const stamp = parseStamp(field(row, ["carimbo de data/hora", "carimbo de data hora"]));
      const nome = field(row, ["nome completo", "nome"]);
      if (!stamp || !nome || !confirmou(field(row, ["confirmo que estive presente", "presente"]))) return;
      people.push({
        data: stamp.data,
        hora: stamp.hora,
        nome,
        email: field(row, ["endereco de e-mail", "email", "e-mail"]),
      });
    });
    return people;
  }

  async function fetchCsv() {
    const join = CONFIG.frequenciaCsvUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${CONFIG.frequenciaCsvUrl}${join}_=${Date.now()}`);
    if (!response.ok) throw new Error("A planilha de presença não respondeu.");
    const csv = await response.text();
    if (!csv || csv.trim().startsWith("<")) throw new Error("A resposta não é a planilha de presença.");
    return csv;
  }

  async function load(force) {
    if (records && !force) return records;
    if (pending && !force) return pending;
    error = "";
    pending = (async () => {
      try {
        records = parse(await fetchCsv());
        return records;
      } catch (err) {
        records = null;
        error = err.message || "Não foi possível ler a planilha de presença.";
        throw err;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  function presentes(iso) {
    if (!records) return null;
    const seen = new Map();
    records
      .filter((pessoa) => pessoa.data === iso)
      .forEach((pessoa) => {
        const key = norm(pessoa.nome);
        if (!key || seen.has(key)) return;
        seen.set(key, pessoa);
      });
    return [...seen.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function datas() {
    const totals = new Map();
    const seen = new Set();
    (records || []).forEach((pessoa) => {
      const key = `${pessoa.data}|${norm(pessoa.nome)}`;
      if (seen.has(key)) return;
      seen.add(key);
      totals.set(pessoa.data, (totals.get(pessoa.data) || 0) + 1);
    });
    return [...totals.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }

  function labelData(iso) {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function note(text, isError) {
    const element = document.getElementById("freq-nota");
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function render() {
    const select = document.getElementById("freq-data");
    const list = document.getElementById("freq-lista");
    const total = document.getElementById("freq-total");
    if (error) {
      select.innerHTML = "";
      list.innerHTML = "";
      total.innerHTML = "<strong>—</strong><span>presentes</span>";
      note(error, true);
      return;
    }
    const options = datas();
    if (!options.length) {
      select.innerHTML = "";
      list.innerHTML = "";
      total.innerHTML = "<strong>0</strong><span>presentes</span>";
      note("Nenhuma presença na planilha.");
      return;
    }
    if (!options.some(([data]) => data === selected)) selected = options[0][0];
    select.innerHTML = options
      .map(([data, count]) => `<option value="${esc(data)}">${labelData(data)} · ${count}</option>`)
      .join("");
    select.value = selected;
    const people = presentes(selected) || [];
    total.innerHTML = `<strong>${people.length}</strong><span>${people.length === 1 ? "presente" : "presentes"}</span>`;
    list.innerHTML = people
      .map((pessoa) => {
        const extra = [pessoa.email, pessoa.hora].filter(Boolean).join(" · ");
        return `<li><strong>${esc(pessoa.nome)}</strong>${extra ? `<span>${esc(extra)}</span>` : ""}</li>`;
      })
      .join("");
    note("");
  }

  async function show() {
    note("Carregando presenças…");
    try {
      await load();
    } catch (err) {
      /* render mostra a mensagem */
    }
    render();
  }

  function boot() {
    document.getElementById("freq-data").addEventListener("change", (event) => {
      selected = event.target.value;
      render();
    });
    document.getElementById("freq-refresh").addEventListener("click", async () => {
      note("Atualizando presenças…");
      try {
        await load(true);
      } catch (err) {
        /* render mostra a mensagem */
      }
      render();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
  return { show, load, presentes, erro: () => error };
})();

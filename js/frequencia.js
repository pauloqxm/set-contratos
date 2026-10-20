/* Aba Frequência: presenças da planilha, por data. Se o dia tiver mais de um bloco, mostra também o horário. */
const Frequencia = (() => {
  let records = null;
  let error = "";
  let pending = null;
  let selected = "";
  let pessoa = "";
  let chartDatas = [];

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

  const intervaloSessao = 60;

  function minutos(hora) {
    const [hour, minute] = String(hora || "00:00").split(":").map(Number);
    return (hour || 0) * 60 + (minute || 0);
  }

  function pessoasUnicas(lista) {
    const seen = new Map();
    lista.forEach((pessoaItem) => {
      const key = norm(pessoaItem.nome);
      if (!key || seen.has(key)) return;
      seen.set(key, pessoaItem);
    });
    return [...seen.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function sessoes() {
    if (!records) return [];
    const porDia = new Map();
    records.forEach((pessoaItem) => {
      if (!porDia.has(pessoaItem.data)) porDia.set(pessoaItem.data, []);
      porDia.get(pessoaItem.data).push(pessoaItem);
    });
    const lista = [];
    [...porDia.keys()].sort().forEach((data) => {
      const ordem = porDia.get(data).slice().sort((a, b) => a.hora.localeCompare(b.hora) || a.nome.localeCompare(b.nome, "pt-BR"));
      const blocos = [];
      ordem.forEach((pessoaItem) => {
        const last = blocos[blocos.length - 1];
        if (!last || minutos(pessoaItem.hora) - minutos(last.fim) > intervaloSessao) {
          blocos.push({ hora: pessoaItem.hora, fim: pessoaItem.hora, pessoas: [pessoaItem] });
        } else {
          last.pessoas.push(pessoaItem);
          if (pessoaItem.hora > last.fim) last.fim = pessoaItem.hora;
        }
      });
      const multi = blocos.length > 1;
      blocos.forEach((bloco) => {
        lista.push({
          id: `${data}T${bloco.hora}`,
          data,
          hora: bloco.hora,
          fim: bloco.fim,
          multi,
          people: pessoasUnicas(bloco.pessoas),
        });
      });
    });
    return lista.sort((a, b) => b.data.localeCompare(a.data) || b.hora.localeCompare(a.hora));
  }

  function sessoesDoDia(iso) {
    if (!records) return null;
    return sessoes().filter((item) => item.data === iso);
  }

  function labelSessao(sessao, curto) {
    if (!sessao) return "";
    const data = curto ? labelCurto(sessao.data) : labelData(sessao.data);
    return sessao.multi ? `${data} ${sessao.hora}` : data;
  }

  function resolverSessao(valor) {
    const lista = sessoes();
    if (!lista.length) return null;
    if (!valor) return lista[0];
    return lista.find((item) => item.id === valor) || lista.find((item) => item.data === valor) || lista[0];
  }

  function sessaoProxima(iso, hora) {
    const doDia = sessoesDoDia(iso) || [];
    if (!doDia.length) return null;
    if (doDia.length === 1) return doDia[0];
    const agora = new Date();
    const padrao = iso === hojeIso()
      ? `${pad(agora.getHours())}:${pad(agora.getMinutes())}`
      : doDia[0].hora;
    const alvo = minutos(hora || padrao);
    return doDia.slice().sort((a, b) => Math.abs(minutos(a.hora) - alvo) - Math.abs(minutos(b.hora) - alvo))[0];
  }

  function presentes(iso, sessaoId) {
    if (!records) return null;
    const doDia = sessoes().filter((item) => item.data === iso);
    if (!doDia.length) return [];
    const sessao = sessaoId
      ? doDia.find((item) => item.id === sessaoId)
      : sessaoProxima(iso);
    return sessao ? sessao.people : doDia[0].people;
  }

  function datas() {
    return sessoes().map((sessao) => [sessao.data, sessao.people.length, sessao]);
  }

  function labelData(iso) {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function labelCurto(iso) {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year.slice(2)}`;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function hojeIso() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function addDays(iso, days) {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function janela(dias) {
    const fim = hojeIso();
    return { inicio: addDays(fim, -dias), fim };
  }

  function reunioesEntre(inicio, fim) {
    return sessoes().filter((sessao) => sessao.data >= inicio && sessao.data <= fim);
  }

  function catalogo() {
    const map = new Map();
    sessoes().forEach((sessao) => {
      sessao.people.forEach((pessoaItem) => {
        const chave = norm(pessoaItem.nome);
        if (!chave) return;
        let item = map.get(chave);
        if (!item) {
          item = { chave, nome: pessoaItem.nome, grafias: new Map(), sessoes: new Set() };
          map.set(chave, item);
        }
        item.sessoes.add(sessao.id);
        item.grafias.set(pessoaItem.nome, (item.grafias.get(pessoaItem.nome) || 0) + 1);
      });
    });
    map.forEach((item) => {
      item.nome = [...item.grafias.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    });
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }

  function periodoConsulta() {
    const padrao = janela(60);
    const de = document.getElementById("freq-de").value;
    const ate = document.getElementById("freq-ate").value;
    const inicio = de || (ate ? addDays(ate, -60) : padrao.inicio);
    const fim = ate || padrao.fim;
    return { inicio, fim, invalido: inicio > fim };
  }

  function setFigura(id, value) {
    document.getElementById(id).textContent = value;
  }

  function note(text, isError) {
    const element = document.getElementById("freq-nota");
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function renderKpis() {
    const metaReunioes = document.getElementById("freq-kpi-reunioes-meta");
    const metaMedia = document.getElementById("freq-kpi-media-meta");
    const metaDistintas = document.getElementById("freq-kpi-distintas-meta");
    const mes = janela(30);
    const texto = `${labelData(mes.inicio)} a ${labelData(mes.fim)}`;
    if (error || !records) {
      setFigura("freq-kpi-reunioes", "—");
      setFigura("freq-kpi-media", "—");
      setFigura("freq-kpi-distintas", "—");
      metaReunioes.textContent = "Últimos 30 dias";
      metaMedia.textContent = "Pessoas nos últimos 30 dias";
      metaDistintas.textContent = "Quem veio ao menos uma vez";
      return;
    }
    const reunioes = reunioesEntre(mes.inicio, mes.fim);
    const pessoas = new Set();
    reunioes.forEach((sessao) => {
      sessao.people.forEach((item) => pessoas.add(norm(item.nome)));
    });
    const media = reunioes.length
      ? reunioes.reduce((soma, sessao) => soma + sessao.people.length, 0) / reunioes.length
      : null;
    setFigura("freq-kpi-reunioes", String(reunioes.length));
    setFigura("freq-kpi-media", media == null ? "—" : media.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
    setFigura("freq-kpi-distintas", String(pessoas.size));
    metaReunioes.textContent = texto;
    metaMedia.textContent = `Pessoas por reunião · ${texto}`;
    metaDistintas.textContent = `Quem veio ao menos uma vez · ${texto}`;
  }

  function renderChart() {
    const canvas = document.getElementById("freq-chart");
    const vazio = document.getElementById("freq-chart-vazio");
    const box = canvas.parentElement;
    if (typeof Chart !== "undefined") {
      if (typeof ChartDataLabels !== "undefined") Chart.unregister(ChartDataLabels);
      const previous = Chart.getChart(canvas);
      if (previous) previous.destroy();
    }
    const ultimas = error || !records ? [] : sessoes().slice(0, 7).reverse();
    chartDatas = ultimas.map((sessao) => sessao.id);
    const semGrafico = !ultimas.length || typeof Chart === "undefined";
    vazio.hidden = !semGrafico;
    box.hidden = semGrafico;
    if (semGrafico) {
      if (!ultimas.length) vazio.textContent = error || "Ainda não há reuniões para o gráfico.";
      else vazio.textContent = "Gráfico indisponível.";
      return;
    }
    const plugin = typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [];
    new Chart(canvas, {
      type: "bar",
      plugins: plugin,
      data: {
        labels: ultimas.map((sessao) => labelSessao(sessao, true)),
        datasets: [{
          label: "Presentes",
          data: ultimas.map((sessao) => sessao.people.length),
          backgroundColor: "#39B54A",
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        onClick(_event, elements) {
          if (!elements.length) return;
          selected = chartDatas[elements[0].index];
          renderDia();
        },
        onHover(event, elements) {
          event.native.target.style.cursor = elements.length ? "pointer" : "default";
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "top",
            color: "#4D4D4D",
            font: { weight: "700" },
            formatter: (value) => value,
          },
          tooltip: {
            callbacks: {
              title(items) {
                const sessao = resolverSessao(chartDatas[items[0].dataIndex]);
                return sessao ? labelSessao(sessao) : "";
              },
              label(item) {
                return `${item.raw} presentes`;
              },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grace: "18%" },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function renderPessoa() {
    const select = document.getElementById("freq-pessoa");
    const resumo = document.getElementById("freq-pessoa-resumo");
    const lista = document.getElementById("freq-pessoa-lista");
    const busca = norm(document.getElementById("freq-pessoa-busca").value);
    if (error || !records) {
      select.innerHTML = '<option value="">Escolha a pessoa</option>';
      resumo.textContent = error || "Escolha uma pessoa para ver as reuniões.";
      lista.innerHTML = "";
      return;
    }
    const pessoas = catalogo().filter((item) => !busca || norm(item.nome).includes(busca) || item.chave === pessoa);
    select.innerHTML = ['<option value="">Escolha a pessoa</option>']
      .concat(pessoas.map((item) => `<option value="${esc(item.chave)}">${esc(item.nome)} · ${item.sessoes.size}</option>`))
      .join("");
    select.value = pessoas.some((item) => item.chave === pessoa) ? pessoa : "";
    if (select.value !== pessoa) pessoa = select.value;
    if (!pessoa) {
      resumo.textContent = "Escolha uma pessoa para ver as reuniões.";
      lista.innerHTML = "";
      return;
    }
    const escolhida = catalogo().find((item) => item.chave === pessoa);
    const periodo = periodoConsulta();
    if (periodo.invalido) {
      resumo.textContent = "A data inicial é posterior à final.";
      lista.innerHTML = "";
      return;
    }
    const reunioes = reunioesEntre(periodo.inicio, periodo.fim);
    const presentesPeriodo = reunioes.filter((sessao) => escolhida.sessoes.has(sessao.id));
    const intervalo = `${labelData(periodo.inicio)} a ${labelData(periodo.fim)}`;
    resumo.textContent = presentesPeriodo.length
      ? `${escolhida.nome} esteve em ${presentesPeriodo.length} de ${reunioes.length} ${reunioes.length === 1 ? "reunião" : "reuniões"} entre ${intervalo}.`
      : `${escolhida.nome} não confirmou presença entre ${intervalo}. Houve ${reunioes.length} ${reunioes.length === 1 ? "reunião" : "reuniões"} nesse período.`;
    lista.innerHTML = presentesPeriodo
      .map((sessao) => {
        const extra = sessao.multi ? "" : (sessao.people.find((item) => norm(item.nome) === pessoa)?.hora ? `<span>${esc(sessao.hora)}</span>` : "");
        return `<li><button type="button" data-sessao="${esc(sessao.id)}"><span class="freq-ok" aria-hidden="true"></span><span class="freq-nome"><strong>${esc(labelSessao(sessao))}</strong>${extra}</span></button></li>`;
      })
      .join("");
  }

  function renderDia() {
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
    const options = sessoes();
    if (!options.length) {
      select.innerHTML = "";
      list.innerHTML = "";
      total.innerHTML = "<strong>0</strong><span>presentes</span>";
      note("Nenhuma presença na planilha.");
      return;
    }
    const atual = resolverSessao(selected);
    selected = atual ? atual.id : options[0].id;
    select.innerHTML = options
      .map((sessao) => `<option value="${esc(sessao.id)}">${esc(labelSessao(sessao))} · ${sessao.people.length}</option>`)
      .join("");
    select.value = selected;
    const people = atual ? atual.people : [];
    total.innerHTML = `<strong>${people.length}</strong><span>${people.length === 1 ? "presente" : "presentes"}</span>`;
    list.innerHTML = people
      .map((item) => {
        const extra = [item.email, item.hora].filter(Boolean).join(" · ");
        return `<li><span class="freq-ok" aria-hidden="true"></span><span class="freq-nome"><strong>${esc(item.nome)}</strong>${extra ? `<span>${esc(extra)}</span>` : ""}</span></li>`;
      })
      .join("");
    note("");
  }

  function render() {
    renderKpis();
    renderChart();
    renderPessoa();
    renderDia();
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
      renderDia();
    });
    document.getElementById("freq-pessoa-busca").addEventListener("input", renderPessoa);
    document.getElementById("freq-pessoa").addEventListener("change", (event) => {
      pessoa = event.target.value;
      renderPessoa();
    });
    document.getElementById("freq-de").addEventListener("change", renderPessoa);
    document.getElementById("freq-ate").addEventListener("change", renderPessoa);
    document.getElementById("freq-pessoa-lista").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-sessao]");
      if (!button) return;
      selected = button.dataset.sessao;
      renderDia();
      document.getElementById("freq-lista").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  function ultimaSessao() {
    return sessoes()[0] || null;
  }

  function ultimaData() {
    return ultimaSessao()?.data || "";
  }

  return {
    show,
    load,
    presentes,
    sessoesDoDia,
    sessaoProxima,
    labelSessao,
    ultimaSessao,
    ultimaData,
    erro: () => error,
  };
})();

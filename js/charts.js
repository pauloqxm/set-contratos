/* Gráficos do painel. Clique em fatia, barra ou mês aplica filtro. */
const Charts = (() => {
  const PALETTE = ["#39B54A", "#F15A24", "#0071BC", "#0D9488", "#ED7526", "#7C6A9A", "#C1443C", "#5BA3D9", "#2F9A3D", "#6D6E71"];
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  let prepared = false;

  function prepare() {
    if (prepared || typeof Chart === "undefined") return;
    prepared = true;
    if (typeof ChartDataLabels !== "undefined") Chart.unregister(ChartDataLabels);
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || "Montserrat, sans-serif";
    Chart.defaults.color = "#6D6E71";
    Chart.defaults.plugins.tooltip.backgroundColor = "#4D4D4D";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
  }

  function labelColor(color) {
    const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    let red;
    let green;
    let blue;
    if (match) {
      red = Number(match[1]);
      green = Number(match[2]);
      blue = Number(match[3]);
    } else {
      const hex = String(color).replace("#", "");
      red = parseInt(hex.slice(0, 2), 16);
      green = parseInt(hex.slice(2, 4), 16);
      blue = parseInt(hex.slice(4, 6), 16);
    }
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    return luminance > 0.72 ? "#4D4D4D" : "#ffffff";
  }

  function withAlpha(hex, alpha) {
    const value = hex.replace("#", "");
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function dim(row, key) {
    return Data.fieldLabel(row[key], key);
  }

  function groupCount(rows, key) {
    const map = new Map();
    rows.forEach((row) => {
      const name = dim(row, key);
      map.set(name, (map.get(name) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  }

  function topGroups(entries) {
    if (entries.length <= 8) {
      return entries.map(([name, count]) => ({ label: name, count, names: [name] }));
    }
    const head = entries.slice(0, 6);
    const tail = entries.slice(6);
    const groups = head.map(([name, count]) => ({ label: name, count, names: [name] }));
    groups.push({
      label: "OUTROS",
      count: tail.reduce((sum, entry) => sum + entry[1], 0),
      names: tail.map((entry) => entry[0]),
    });
    return groups;
  }

  function selectedMatch(names, selected) {
    if (!selected || !selected.length) return false;
    return names.length === selected.length && names.every((name) => selected.includes(name));
  }

  function mount(canvas, config) {
    const previous = Chart.getChart(canvas);
    if (previous) previous.destroy();
    return new Chart(canvas, config);
  }

  function setEmpty(id, isEmpty) {
    const empty = document.getElementById(`empty-${id}`);
    const box = document.getElementById(`box-${id}`);
    const legend = document.getElementById(`legend-${id}`);
    if (empty) empty.hidden = !isEmpty;
    if (box) box.hidden = isEmpty;
    if (legend) legend.hidden = isEmpty;
    if (isEmpty && typeof Chart !== "undefined") {
      const canvas = document.getElementById(`chart-${id}`);
      const previous = canvas && Chart.getChart(canvas);
      if (previous) previous.destroy();
    }
  }

  function renderLegend(id, groups, selected, onSelect) {
    const list = document.getElementById(`legend-${id}`);
    if (!list) return;
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    list.innerHTML = groups
      .map((group, index) => {
        const color = group.label === "OUTROS" ? "#D1D3D4" : PALETTE[index % PALETTE.length];
        const pct = total ? (group.count / total) * 100 : 0;
        const on = selectedMatch(group.names, selected);
        return `<li><button type="button" class="${on ? "is-on" : ""}" data-index="${index}">
          <i style="background:${color}"></i>
          <span>${escapeHtml(group.label)}</span>
          <b>${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b>
        </button></li>`;
      })
      .join("");
    list.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const group = groups[Number(button.dataset.index)];
        if (group) onSelect(group.names);
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function renderDonut(id, rows, key, selected, onSelect) {
    const groups = topGroups(groupCount(rows, key));
    setEmpty(id, !groups.length);
    renderLegend(id, groups, selected, onSelect);
    const canvas = document.getElementById(`chart-${id}`);
    if (!canvas || !groups.length || typeof Chart === "undefined") return;
    const colors = groups.map((group, index) => {
      const hex = group.label === "OUTROS" ? "#D1D3D4" : PALETTE[index % PALETTE.length];
      if (!selected || !selected.length) return hex;
      return selectedMatch(group.names, selected) ? hex : withAlpha(hex, 0.28);
    });
    const plugin = typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [];
    mount(canvas, {
      type: "doughnut",
      plugins: plugin,
      data: {
        labels: groups.map((group) => group.label),
        datasets: [{
          data: groups.map((group) => group.count),
          backgroundColor: colors,
          borderColor: "#ffffff",
          borderWidth: 2,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { display: false },
          datalabels: {
            display(ctx) {
              const data = ctx.dataset.data;
              const total = data.reduce((sum, value) => sum + value, 0);
              return total && data[ctx.dataIndex] / total >= 0.07;
            },
            color: (ctx) => labelColor(ctx.dataset.backgroundColor[ctx.dataIndex]),
            font: { weight: "700", size: 11 },
            formatter(value, ctx) {
              const total = ctx.dataset.data.reduce((sum, item) => sum + item, 0);
              if (!total) return "";
              return `${Math.round((value / total) * 100)}%`;
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((sum, item) => sum + item, 0);
                const pct = total ? (ctx.parsed / total) * 100 : 0;
                return ` ${ctx.label}: ${ctx.parsed} (${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`;
              },
            },
          },
        },
        onClick(event, _elements, chart) {
          const points = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true);
          if (!points.length) return;
          const group = groups[points[0].index];
          if (group) onSelect(group.names);
        },
      },
    });
  }

  function renderGauge(empenhado, valorTotal) {
    const canvas = document.getElementById("chart-gauge");
    const empty = document.getElementById("empty-gauge");
    if (!canvas || typeof Chart === "undefined") {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    const used = Math.max(empenhado, 0);
    const rest = Math.max(valorTotal - empenhado, 0);
    const hasValue = valorTotal > 0 || used > 0;
    mount(canvas, {
      type: "doughnut",
      data: {
        labels: ["Empenhado", "Saldo a empenhar"],
        datasets: [{
          data: hasValue ? [used, rest || (used ? 0 : 1)] : [0, 1],
          backgroundColor: hasValue && used ? ["#39B54A", "#E4E4E4"] : ["#E4E4E4", "#E4E4E4"],
          borderWidth: 0,
          circumference: 180,
          rotation: 270,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "74%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(ctx) {
                if (!hasValue) return " Sem valores";
                return ` ${ctx.label}: ${Data.formatMoney(ctx.raw)}`;
              },
            },
          },
        },
      },
    });
  }

  function peopleGroups(rows, key) {
    const entries = groupCount(rows, key);
    if (entries.length <= 12) {
      return entries.map(([name, count]) => ({ label: name, count, names: [name] }));
    }
    return topGroups(entries);
  }

  function renderPeople(id, rows, key, selected, onSelect) {
    const groups = peopleGroups(rows, key);
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    setEmpty(id, !groups.length);
    const canvas = document.getElementById(`chart-${id}`);
    const box = document.getElementById(`box-${id}`);
    if (!canvas || !groups.length || typeof Chart === "undefined") return;
    if (box) box.style.height = `${Math.max(220, groups.length * 34 + 24)}px`;
    const plugin = typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [];
    mount(canvas, {
      type: "bar",
      plugins: plugin,
      data: {
        labels: groups.map((group) => group.label),
        datasets: [{
          data: groups.map((group) => group.count),
          backgroundColor: groups.map((group) => {
            const base = group.label === "Sem fiscal designado" ? "#D97706" : "#0071BC";
            if (!selected || !selected.length) return base;
            return selectedMatch(group.names, selected) ? base : withAlpha(base, 0.28);
          }),
          borderRadius: 6,
          maxBarThickness: 16,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 78 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            clamp: true,
            color: "#4D4D4D",
            font: { weight: "700", size: 11 },
            formatter(value) {
              const pct = total ? (value / total) * 100 : 0;
              return `${value} · ${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                const pct = total ? (ctx.parsed.x / total) * 100 : 0;
                return ` ${ctx.label}: ${ctx.parsed.x} (${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`;
              },
            },
          },
        },
        scales: {
          x: { display: false, grace: "18%" },
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 11, weight: "600" },
              color: (ctx) => (groups[ctx.index] && groups[ctx.index].label === "Sem fiscal designado" ? "#D97706" : "#4D4D4D"),
            },
          },
        },
        onClick(event, _elements, chart) {
          const points = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true);
          if (!points.length) return;
          const group = groups[points[0].index];
          if (group) onSelect(group.names);
        },
      },
    });
  }

  function categoryGroups(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const name = dim(row, "categoria");
      map.set(name, (map.get(name) || 0) + row.valorTotal);
    });
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length <= 7) {
      return sorted.map(([name, total]) => ({ label: name, names: [name], total }));
    }
    const head = sorted.slice(0, 6).map(([name, total]) => ({ label: name, names: [name], total }));
    const tail = sorted.slice(6);
    head.push({
      label: "OUTRAS",
      names: tail.map(([name]) => name),
      total: tail.reduce((sum, entry) => sum + entry[1], 0),
    });
    return head;
  }

  function renderCategoria(rows, selected, onSelect) {
    const entries = categoryGroups(rows);
    const grand = entries.reduce((sum, entry) => sum + entry.total, 0);

    setEmpty("categoria", !entries.length);
    const canvas = document.getElementById("chart-categoria");
    const box = document.getElementById("box-categoria");
    if (!canvas || !entries.length || typeof Chart === "undefined") return;
    if (box) box.style.height = `${Math.max(240, entries.length * 38 + 28)}px`;
    const plugin = typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [];
    mount(canvas, {
      type: "bar",
      plugins: plugin,
      data: {
        labels: entries.map((entry) => entry.label),
        datasets: [{
          data: entries.map((entry) => (grand ? (entry.total / grand) * 100 : 0)),
          backgroundColor: entries.map((entry) => (selectedMatch(entry.names, selected) ? "#39B54A" : "#0071BC")),
          borderRadius: 6,
          maxBarThickness: 18,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 128 } },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            clamp: true,
            color: "#4D4D4D",
            font: { weight: "700", size: 10 },
            formatter(value, ctx) {
              const amount = entries[ctx.dataIndex].total;
              return `${Data.formatCompact(amount)} · ${Data.formatPercent(value / 100, 1)}`;
            },
          },
          tooltip: {
            callbacks: {
              label(ctx) {
                return ` ${Data.formatMoney(entries[ctx.dataIndex].total)} (${Data.formatPercent(ctx.parsed.x / 100, 1)})`;
              },
            },
          },
        },
        scales: {
          x: {
            max: 100,
            ticks: { callback: (value) => `${value}%`, maxTicksLimit: 5 },
            grid: { color: "#ececec" },
          },
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 11, weight: "600" },
              callback(value) {
                const label = this.getLabelForValue(value);
                return label.length > 32 ? `${label.slice(0, 30)}…` : label;
              },
            },
          },
        },
        onClick(event, _elements, chart) {
          const points = chart.getElementsAtEventForMode(event, "nearest", { intersect: true }, true);
          if (!points.length) return;
          onSelect(entries[points[0].index].names);
        },
      },
    });
  }

  function nextMonths(count) {
    const now = new Date();
    const keys = [];
    for (let index = 0; index < count; index += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      keys.push(key);
    }
    return keys;
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return `${MONTHS[month - 1]}/${String(year).slice(2)}`;
  }

  function renderTimeline(rows, activeMonth, onMonth) {
    const keys = nextMonths(12);
    const counts = keys.map((key) => rows.filter((row) => Data.monthKey(row.terminoEfetivo) === key).length);
    const hasAny = counts.some((count) => count > 0);
    setEmpty("timeline", !hasAny);
    const canvas = document.getElementById("chart-timeline");
    if (!canvas || !hasAny || typeof Chart === "undefined") return;
    const plugin = typeof ChartDataLabels !== "undefined" ? [ChartDataLabels] : [];
    const colors = keys.map((key) => timelineColor(key));
    mount(canvas, {
      type: "bar",
      plugins: plugin,
      data: {
        labels: keys.map(monthLabel),
        datasets: [{
          data: counts,
          backgroundColor: colors,
          borderColor: keys.map((key) => (key === activeMonth ? "#4D4D4D" : "transparent")),
          borderWidth: keys.map((key) => (key === activeMonth ? 2 : 0)),
          borderRadius: 6,
          maxBarThickness: 28,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#4D4D4D",
            font: { weight: "700", size: 11 },
            formatter: (value) => (value ? value : ""),
          },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} ${ctx.parsed.y === 1 ? "contrato" : "contratos"}`,
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#ececec" } },
          x: { grid: { display: false } },
        },
        onClick(event, _elements, chart) {
          const points = chart.getElementsAtEventForMode(event, "index", { intersect: false }, true);
          if (!points.length) return;
          onMonth(keys[points[0].index]);
        },
      },
    });
  }

  function daysUntilMonth(key) {
    const [year, month] = key.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((start - today) / 86400000);
  }

  function timelineColor(key) {
    const days = daysUntilMonth(key);
    if (days < CONFIG.alertaCritico) return "#C1443C";
    if (days < CONFIG.alertaAtencao) return "#D97706";
    return "#39B54A";
  }

  function unavailable() {
    ["gestor", "fiscal", "categoria", "timeline"].forEach((id) => {
      const empty = document.getElementById(`empty-${id}`);
      const box = document.getElementById(`box-${id}`);
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Gráfico indisponível. A tabela continua funcionando.";
      }
      if (box) box.hidden = true;
    });
  }

  function render(model) {
    prepare();
    if (typeof Chart === "undefined") {
      unavailable();
      return;
    }
    renderPeople("gestor", model.gestorRows, "gestor", model.selected.gestor, (names) => model.onDim("gestor", names));
    renderPeople("fiscal", model.fiscalRows, "fiscal", model.selected.fiscal, (names) => model.onDim("fiscal", names));
    renderCategoria(model.categoriaRows, model.selected.categoria, (names) => model.onDim("categoria", names));
    renderTimeline(model.timelineRows, model.selected.mes, model.onMonth);
  }

  return { render, monthLabel };
})();

/* Aba da ata: rascunho no navegador, login pelo SSO e gravação pela função "ata" do Supabase. */
const Ata = (() => {
  const storageKey = "set-ata-rascunho";
  const returnKey = "set-ata-voltar";
  const tokenKey = "set-ata-token";
  let draft = loadDraft();
  let expired = false;
  let editando = !draft.id;
  let pedindoToken = false;
  let pendenteExcluir = null;
  let vistaAtual = "inicio";
  const extrasVisiveis = new Set();
  const extraCampos = [
    {
      campo: "responsaveis",
      rotulo: "Responsáveis",
      tipo: "text",
      placeholder: "Quem ficou responsável",
      svg: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.8 19c.6-3.2 2.8-5 5.2-5s4.6 1.8 5.2 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="17" cy="9" r="2.4" stroke="currentColor" stroke-width="1.8"/><path d="M20.4 18.5c-.4-2.2-1.8-3.5-3.4-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    },
    {
      campo: "encaminhamentos",
      rotulo: "Encaminhamentos",
      tipo: "textarea",
      placeholder: "O que ficou combinado",
      svg: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M5 12h10M5 17h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 15.5 17.2 17.7 21 13.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    },
    {
      campo: "anexo",
      rotulo: "Anexo",
      tipo: "url",
      placeholder: "https://",
      svg: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 8.2v8.5a3.3 3.3 0 0 0 6.6 0V8a2.2 2.2 0 1 0-4.4 0v8.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    },
  ];

  function semearExtras(itens) {
    (itens || []).forEach((item) => {
      extraCampos.forEach(({ campo }) => {
        if (String(item[campo] || "").trim()) extrasVisiveis.add(extraId(item, campo));
      });
    });
  }
  semearExtras(draft.itens);

  function localISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function tipoDe(valor) {
    if (valor === "comite" || valor === "diversa") return valor;
    return "contratos";
  }

  function comite(tipo = draft?.tipo) {
    return tipoDe(tipo) === "comite";
  }

  function diversa(tipo = draft?.tipo) {
    return tipoDe(tipo) === "diversa";
  }

  function tituloPadrao(tipo) {
    const hoje = new Date().toLocaleDateString("pt-BR");
    if (comite(tipo)) return `Reunião do Comitê Executivo ${hoje}`;
    if (diversa(tipo)) return `Reunião diversa ${hoje}`;
    return `Reunião de contratos ${hoje}`;
  }

  function emptyDraft(tipo = "contratos") {
    const today = new Date();
    return {
      id: null,
      tipo: tipoDe(tipo),
      titulo: tituloPadrao(tipo),
      data: localISO(today),
      responsavel_nome: "",
      participantes: null,
      duracao: "",
      inicio: "",
      fim: "",
      freqSessao: "",
      itens: [],
    };
  }

  function loadDraft() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && Array.isArray(saved.itens)) {
        const draft = { ...emptyDraft(), ...saved };
        const local = localISO();
        const utc = new Date().toISOString().slice(0, 10);
        if (!draft.id && draft.data === utc && utc !== local) draft.data = local;
        return draft;
      }
    } catch (error) {
      /* rascunho inválido volta ao vazio */
    }
    return emptyDraft();
  }

  function saveDraft() {
    sessionStorage.setItem(storageKey, JSON.stringify(draft));
  }

  function note(text, isError) {
    const element = document.getElementById("ata-login-note");
    element.hidden = !text;
    element.textContent = text || "";
    element.classList.toggle("is-error", Boolean(isError));
  }

  function profile() {
    const raw = SSO.user()?.profile || {};
    return {
      sub: raw.sub || "",
      name: SSO.displayName(),
      email: (raw.email || "").trim(),
    };
  }

  async function api(method, params, body, retried) {
    const url = new URL(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.ataFunction}`);
    Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    const who = profile();
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          apikey: CONFIG.supabaseKey,
          "x-sso-token": SSO.user().id_token,
          "x-sso-name": who.name,
          "x-sso-email": who.email,
          ...(sessionStorage.getItem(tokenKey) ? { "x-ata-token": sessionStorage.getItem(tokenKey) } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error("Não foi possível falar com o banco. A função da ata precisa estar publicada no Supabase.");
    }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      expired = true;
      throw new Error(data.erro || "O acesso à ata foi recusado. Saia e entre de novo.");
    }
    if (response.status === 403) {
      sessionStorage.removeItem(tokenKey);
      aplicarTrava();
      throw new Error(data.erro || "O Supabase recusou a operação (403) antes de conferir o token.");
    }
    if (!response.ok) throw new Error(data.erro || `O banco respondeu com erro ${response.status}.`);
    return data;
  }

  function relogin() {
    readMeta();
    sessionStorage.setItem(returnKey, "1");
    SSO.login();
  }

  function itemKey(row) {
    return row.nup || row.id;
  }

  function stampText(value) {
    if (value == null || value === "") return "";
    return formatDuration(value);
  }

  function anexoHref(valor) {
    const raw = String(valor || "").trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw && !/\s/.test(raw) && raw.includes(".")) return `https://${raw}`;
    return "";
  }

  function anexoHtml(valor) {
    const href = anexoHref(valor);
    if (href) return `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(valor)}</a>`;
    return esc(String(valor || "").trim() || "—");
  }

  function nomeAta() {
    const data = (dataBR(draft.data) || "").replaceAll("/", "-") || "sem-data";
    if (comite()) return `Ata da Reunião do Comitê ${data}`;
    if (diversa()) return `Ata da Reunião Diversa ${data}`;
    return `Ata da Reunião de Contratos ${data}`;
  }

  function toggleMenu(open) {
    const list = document.getElementById("menu-list");
    const next = open ?? list.hidden;
    list.hidden = !next;
    document.getElementById("menu-toggle").setAttribute("aria-expanded", next ? "true" : "false");
    if (next) list.querySelector(".view-tab.is-on")?.focus();
  }

  function show(view) {
    document.getElementById("view-inicio").hidden = view !== "inicio";
    document.getElementById("view-painel").hidden = view !== "painel";
    document.getElementById("view-comite").hidden = view !== "comite";
    document.getElementById("view-diversa").hidden = view !== "diversa";
    document.getElementById("view-ata").hidden = view !== "ata";
    document.getElementById("view-frequencia").hidden = view !== "frequencia";
    document.querySelectorAll(".view-tab").forEach((button) => {
      const on = button.dataset.view === view;
      button.classList.toggle("is-on", on);
      if (on) {
        button.setAttribute("aria-current", "page");
        document.getElementById("menu-current").textContent = button.querySelector("strong").textContent;
      } else {
        button.removeAttribute("aria-current");
      }
    });
    toggleMenu(false);
    if (view !== "ata") esquecerToken();
    if (view === "ata") {
      aplicarTipo();
      fillMeta();
      renderItems();
      loadList();
    }
    if (view === "comite") Comite.show();
    if (view === "diversa") Diversa.show();
    if (view === "frequencia") Frequencia.show();
    vistaAtual = view;
    pintarAtalhos();
  }

  function reunioesVivas() {
    const lista = [];
    if (state.meeting.startedAt && !state.meeting.endedAt) {
      lista.push({ view: "painel", tipo: "contratos", nome: "Contratos", titulo: "Gestão de Contratos" });
    }
    const doComite = Comite.meeting();
    if (doComite.startedAt && !doComite.endedAt) {
      lista.push({ view: "comite", tipo: "comite", nome: "Comitê", titulo: "Comitê Executivo" });
    }
    const daDiversa = Diversa.meeting();
    if (daDiversa.startedAt && !daDiversa.endedAt) {
      lista.push({ view: "diversa", tipo: "diversa", nome: "Reunião Diversa", titulo: "Reunião Diversa" });
    }
    return lista;
  }

  function pintarAtalhos() {
    const host = document.getElementById("atalhos-reuniao");
    if (!host) return;
    const vivas = reunioesVivas();
    host.hidden = vivas.length === 0;
    host.querySelector('[data-atalho="ata"]').classList.toggle("is-on", vistaAtual === "ata");
    document.getElementById("atalhos-voltar").innerHTML = vivas
      .map((item) => {
        const ligado = vistaAtual === item.view ? " is-on" : "";
        const rotulo = vistaAtual === item.view ? item.nome : `Voltar · ${item.nome}`;
        return `<button type="button" class="atalho-reuniao${ligado}" data-atalho="${item.view}" title="Abrir ${esc(item.titulo)}">${esc(rotulo)}</button>`;
      })
      .join("");
  }

  function irAtalho(view) {
    if (view === "ata") {
      const vivas = reunioesVivas();
      const alvo = vivas.find((item) => item.view === vistaAtual) || (vivas.length === 1 ? vivas[0] : null);
      if (alvo) prepararTipo(alvo.tipo);
    }
    show(view);
  }

  function nomesSalvos() {
    return String(draft.participantes || "")
      .split(",")
      .map((nome) => nome.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function chaveNome(nome) {
    return nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("pt-BR");
  }

  function dataBR(iso) {
    if (!iso || !iso.includes("-")) return iso || "";
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }

  function sessaoEscolhida() {
    const doDia = Frequencia.sessoesDoDia(draft.data);
    if (!doDia || !doDia.length) return null;
    if (draft.freqSessao && doDia.some((item) => item.id === draft.freqSessao)) {
      return doDia.find((item) => item.id === draft.freqSessao);
    }
    return Frequencia.sessaoProxima(draft.data, horariosAtuais().inicio) || doDia[0];
  }

  function pintarSessoes(doDia) {
    const wrap = document.getElementById("ata-freq-sessao-wrap");
    const select = document.getElementById("ata-freq-sessao");
    if (!wrap || !select) return;
    if (!doDia || doDia.length < 2) {
      wrap.hidden = true;
      draft.freqSessao = doDia?.[0]?.id || "";
      return;
    }
    wrap.hidden = false;
    const atual = sessaoEscolhida();
    draft.freqSessao = atual?.id || doDia[0].id;
    select.innerHTML = doDia
      .map((sessao) => `<option value="${esc(sessao.id)}">${esc(Frequencia.labelSessao(sessao))} · ${sessao.people.length}</option>`)
      .join("");
    select.value = draft.freqSessao;
  }

  async function renderParticipantes(refreshed) {
    const host = document.getElementById("ata-participantes-lista");
    const nota = document.getElementById("ata-participantes-nota");
    let doDia = Frequencia.sessoesDoDia(draft.data);
    if (doDia === null) {
      host.innerHTML = "";
      pintarSessoes([]);
      nota.textContent = Frequencia.erro() || "Carregando a lista de presença…";
      if (!Frequencia.erro()) {
        try {
          await Frequencia.load();
        } catch (err) {
          /* a nota mostra o erro na próxima passagem */
        }
        doDia = Frequencia.sessoesDoDia(draft.data);
      }
    }
    pintarSessoes(doDia || []);
    let people = Frequencia.presentes(draft.data, draft.freqSessao);
    if (!people) {
      nota.textContent = Frequencia.erro() || "Não foi possível ler a lista de presença.";
      document.getElementById("ata-presenca-recente").hidden = true;
      aplicarTrava();
      return;
    }
    if (!people.length && !refreshed && !Frequencia.erro()) {
      try {
        await Frequencia.load(true);
      } catch (err) {
        /* a nota mostra o resultado abaixo */
      }
      return renderParticipantes(true);
    }
    if (!draft.id && draft.participantes == null && people.length) {
      draft.participantes = people.map((pessoa) => pessoa.nome).join(", ");
      saveDraft();
    }
    const salvos = nomesSalvos();
    const chaves = new Set(people.map((pessoa) => chaveNome(pessoa.nome)));
    const extras = salvos.filter((nome) => !chaves.has(chaveNome(nome)));
    const marcados = new Set(salvos.map(chaveNome));
    const opcoes = people.map((pessoa) => pessoa.nome).concat(extras);
    const recente = document.getElementById("ata-presenca-recente");
    if (!opcoes.length) {
      host.innerHTML = "";
      const ultima = Frequencia.ultimaSessao();
      recente.hidden = !ultima || ultima.id === draft.freqSessao;
      recente.textContent = ultima ? `Usar a presença de ${Frequencia.labelSessao(ultima)}` : "Usar a presença mais recente";
      nota.textContent = ultima && ultima.data !== draft.data
        ? `Nenhuma presença em ${dataBR(draft.data)}. A mais recente na planilha é ${Frequencia.labelSessao(ultima)}.`
        : doDia && doDia.length > 1
          ? "Nenhuma presença neste horário. Escolha o outro bloco do dia."
          : "Nenhuma presença registrada nesta data.";
      aplicarTrava();
      return;
    }
    recente.hidden = true;
    nota.textContent = doDia && doDia.length > 1
      ? "Quem confirmou presença neste horário. Desmarque quem não entra na ata."
      : "Quem confirmou presença na data da ata. Desmarque quem não entra na ata.";
    host.innerHTML = opcoes
      .map((nome) => {
        const on = marcados.has(chaveNome(nome)) ? " checked" : "";
        return `<label class="freq-check"><input type="checkbox" value="${esc(nome)}"${on} /> ${esc(nome)}<span class="freq-virgula" aria-hidden="true">,</span></label>`;
      })
      .join("");
    aplicarTrava();
  }

  function statusFrequencia(texto, novo) {
    const status = document.getElementById("ata-freq-status");
    status.hidden = !texto;
    status.textContent = texto || "";
    status.classList.toggle("is-novo", Boolean(novo));
  }

  async function atualizarFrequencia() {
    const botao = document.getElementById("ata-freq-atualizar");
    readParticipantes();
    const antes = new Set((Frequencia.presentes(draft.data, draft.freqSessao) || []).map((pessoa) => chaveNome(pessoa.nome)));
    nomesSalvos().forEach((nome) => antes.add(chaveNome(nome)));
    botao.disabled = true;
    botao.classList.add("is-loading");
    statusFrequencia("Buscando na planilha…");
    try {
      await Frequencia.load(true);
    } catch (err) {
      statusFrequencia(Frequencia.erro() || "Não foi possível ler a planilha de presença.");
      return;
    } finally {
      botao.disabled = travada();
      botao.classList.remove("is-loading");
    }
    const novos = (Frequencia.presentes(draft.data, draft.freqSessao) || [])
      .map((pessoa) => pessoa.nome)
      .filter((nome) => !antes.has(chaveNome(nome)));
    if (novos.length && draft.participantes != null) {
      draft.participantes = nomesSalvos().concat(novos).join(", ");
    }
    saveDraft();
    await renderParticipantes(true);
    statusFrequencia(
      novos.length === 0
        ? "Nenhum nome novo."
        : novos.length === 1
          ? "1 novo nome encontrado."
          : `${novos.length} novos nomes encontrados.`,
      novos.length > 0
    );
  }

  function temToken() {
    return Boolean(sessionStorage.getItem(tokenKey));
  }

  function travada() {
    return Boolean(draft.id) && !editando;
  }

  function erroToken(texto) {
    const erro = document.getElementById("ata-token-erro");
    if (!erro) return;
    erro.hidden = !texto;
    erro.textContent = texto || "";
  }

  function fecharToken() {
    pedindoToken = false;
    pendenteExcluir = null;
    const dialog = document.getElementById("ata-token-dialog");
    if (dialog?.open) dialog.close();
    erroToken("");
  }

  function esquecerToken() {
    sessionStorage.removeItem(tokenKey);
    editando = false;
    fecharToken();
  }

  function aplicarTrava() {
    const salva = Boolean(draft.id);
    const trava = travada();
    document.getElementById("ata-edit").hidden = !trava;
    document.getElementById("ata-delete").hidden = !salva;
    document.getElementById("ata-save").hidden = trava;
    document.getElementById("ata-save").disabled = false;
    if (!pedindoToken) fecharToken();
    ["ata-titulo", "ata-data", "ata-responsavel", "ata-from-checks", "ata-busca", "ata-freq-sessao", "ata-freq-atualizar"].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.disabled = trava;
    });
    document.getElementById("ata-tipo").disabled = trava;
    document.querySelectorAll("#ata-participantes-lista input, #ata-itens textarea, #ata-itens input, #ata-itens button, #ata-presenca-recente").forEach((field) => {
      field.disabled = trava;
    });
  }

  function pedirToken(excluirId) {
    pendenteExcluir = excluirId || null;
    pedindoToken = true;
    document.getElementById("ata-editor-nota").textContent = pendenteExcluir
      ? "Informe o token para excluir a ata."
      : "Informe o token para editar a ata.";
    erroToken("");
    const campo = document.getElementById("ata-token");
    campo.value = "";
    const dialog = document.getElementById("ata-token-dialog");
    if (!dialog.open) dialog.showModal();
    campo.focus();
  }

  function readParticipantes() {
    const boxes = [...document.querySelectorAll("#ata-participantes-lista input[type=checkbox]")];
    if (!boxes.length) return;
    draft.participantes = boxes
      .filter((box) => box.checked)
      .map((box) => box.value)
      .join(", ");
  }

  function reuniao() {
    if (comite()) {
      const m = Comite.meeting();
      return { startedAt: m.startedAt, inicio: m.inicio, fim: m.fim, elapsed: Comite.elapsed() };
    }
    if (diversa()) {
      const m = Diversa.meeting();
      return { startedAt: m.startedAt, inicio: m.inicio, fim: m.fim, elapsed: Diversa.elapsed() };
    }
    return { startedAt: state.meeting.startedAt, inicio: state.meeting.inicio, fim: state.meeting.fim, elapsed: meetingElapsed() };
  }

  function reuniaoViva() {
    return !draft.id || draft.data === localISO();
  }

  function horariosAtuais() {
    const atual = reuniao();
    if (atual.inicio && reuniaoViva()) return { inicio: atual.inicio, fim: atual.fim || "" };
    return { inicio: draft.inicio || "", fim: draft.fim || "" };
  }

  function fillHorarios() {
    const horas = horariosAtuais();
    document.getElementById("ata-inicio").value = horas.inicio || "—";
    document.getElementById("ata-fim").value = horas.fim || "—";
    if (reuniao().inicio && reuniaoViva()) {
      draft.inicio = horas.inicio;
      draft.fim = horas.fim;
      saveDraft();
    }
    return horas;
  }

  function currentDuration() {
    const atual = reuniao();
    if (!atual.startedAt || !reuniaoViva()) return draft.duracao;
    return atual.elapsed == null ? draft.duracao : formatDuration(atual.elapsed);
  }

  function aplicarTipo() {
    const tipo = tipoDe(draft.tipo);
    document.getElementById("ata-tipo").value = tipo;
    document.getElementById("ata-heading").textContent = comite()
      ? "Ata do Comitê Executivo"
      : diversa()
        ? "Ata da reunião diversa"
        : "Ata da reunião de contratos";
    document.getElementById("ata-subtitulo").textContent = comite() || diversa()
      ? "Descreva o que foi falado sobre cada ponto. O rascunho fica neste navegador até ser salvo."
      : "Descreva o que foi falado sobre cada objeto. O rascunho fica neste navegador até ser salvo.";
    document.getElementById("ata-from-checks").textContent = comite() || diversa() ? "Trazer pontos discutidos" : "Trazer contratos lidos";
    document.getElementById("ata-busca-rotulo").textContent = comite() ? "Incluir projeto" : diversa() ? "Incluir ponto" : "Incluir contrato";
    document.getElementById("ata-busca").placeholder = comite()
      ? "Nome do projeto"
      : diversa()
        ? "Título do ponto"
        : "Objeto, NUP, contrato ou contratada";
    document.getElementById("ata-vazio").textContent = comite() || diversa()
      ? "Nenhum ponto na ata. Traga os pontos discutidos ou busque um ponto da pauta."
      : "Nenhum objeto na ata. Traga os contratos marcados como lidos ou busque um contrato.";
  }

  async function trocarTipo(tipo) {
    if (draft.id) {
      if (travada()) return;
      readMeta();
      draft.tipo = tipoDe(tipo);
      saveDraft();
      aplicarTipo();
      renderItems();
      loadList();
      note("Tipo alterado. Conclua a ata para gravar a mudança.");
      return;
    }
    readMeta();
    const anterior = draft.tipo;
    draft.tipo = tipoDe(tipo);
    if (diversa() && Diversa.titulo()) draft.titulo = Diversa.titulo();
    else if (!draft.titulo || draft.titulo === tituloPadrao(anterior)) draft.titulo = tituloPadrao(draft.tipo);
    draft.itens = [];
    draft.inicio = "";
    draft.fim = "";
    draft.duracao = "";
    draft.freqSessao = "";
    saveDraft();
    aplicarTipo();
    fillMeta();
    renderItems();
    loadList();
    if (comite()) Comite.load();
  }

  function prepararTipo(tipo) {
    if (draft.id) return;
    const proximo = tipoDe(tipo);
    if (draft.tipo === proximo) {
      if (proximo === "diversa" && Diversa.titulo()) {
        draft.titulo = Diversa.titulo();
        saveDraft();
        const campo = document.getElementById("ata-titulo");
        if (campo) campo.value = draft.titulo;
      }
      return;
    }
    trocarTipo(proximo);
  }

  function definirTitulo(titulo) {
    if (draft.id || !diversa()) return;
    const valor = String(titulo || "").replace(/\s+/g, " ").trim();
    if (!valor) return;
    draft.titulo = valor;
    saveDraft();
    const campo = document.getElementById("ata-titulo");
    if (campo) campo.value = valor;
  }

  function fillMeta() {
    if (!draft.id && !draft.responsavel_nome) {
      draft.responsavel_nome = SSO.displayName() || "";
      saveDraft();
    }
    document.getElementById("ata-titulo").value = draft.titulo;
    document.getElementById("ata-data").value = draft.data;
    document.getElementById("ata-responsavel").value = draft.responsavel_nome;
    document.getElementById("ata-duracao").value = currentDuration() || "Reunião não iniciada";
    fillHorarios();
    renderParticipantes();
    aplicarTrava();
  }

  function readMeta() {
    draft.titulo = document.getElementById("ata-titulo").value.trim();
    draft.data = document.getElementById("ata-data").value;
    draft.responsavel_nome = document.getElementById("ata-responsavel").value.trim();
    readParticipantes();
    saveDraft();
  }

  function addRow(row) {
    const key = itemKey(row);
    if (draft.itens.find((item) => item.key === key)) return false;
    draft.itens.push({
      key,
      nup: row.nup || "",
      contrato: row.contrato || "",
      contratada: row.contratada || "",
      objeto: row.objeto || "",
      tempo: "",
      texto: "",
      responsaveis: "",
      encaminhamentos: "",
      anexo: "",
    });
    return true;
  }

  function addProjeto(projeto) {
    const key = `p:${projeto.id}`;
    if (draft.itens.find((item) => item.key === key)) return false;
    draft.itens.push({ key, ref: projeto.id, nup: "", contrato: "", contratada: "", objeto: projeto.nome || projeto.id, tempo: "", texto: "", responsaveis: "", encaminhamentos: "", anexo: "" });
    return true;
  }

  function fontePauta() {
    if (diversa()) return Diversa.projetos();
    if (comite()) return Comite.projetos();
    return [];
  }

  function marcados() {
    if (diversa()) return Diversa.meeting().checks;
    return comite() ? Comite.meeting().checks : state.meeting.checks;
  }

  function reuniaoAtual() {
    if (diversa()) return Diversa.meeting();
    return comite() ? Comite.meeting() : state.meeting;
  }

  function idDoItem(item) {
    if (item.ref) return item.ref;
    const row = state.rows.find((linha) => linha.id === item.key || linha.nup === item.key || itemKey(linha) === item.key);
    return row?.id || item.key;
  }

  function tempoDoPonto(id) {
    const atual = reuniaoAtual();
    if (atual.currentId === id && atual.currentStartedAt) return Math.max(0, Date.now() - atual.currentStartedAt);
    const stamp = atual.checks.get(id);
    return typeof stamp === "number" ? stamp : null;
  }

  function aplicarTempos() {
    draft.itens.forEach((item) => {
      if (item.tempo) return;
      const ms = tempoDoPonto(idDoItem(item));
      if (ms != null) item.tempo = stampText(ms);
    });
  }

  function bringChecks() {
    let added = 0;
    if (comite() || diversa()) {
      reuniaoAtual().checks.forEach((_tempo, id) => {
        const projeto = fontePauta().find((item) => item.id === id);
        if (projeto && addProjeto(projeto)) added += 1;
      });
    } else {
      state.meeting.checks.forEach((_tempo, id) => {
        const row = state.rows.find((item) => item.id === id);
        if (row && addRow(row)) added += 1;
      });
    }
    saveDraft();
    renderItems();
    return added;
  }

  function extraId(item, campo) {
    return `${item.key || item.ref || item.objeto}:${campo}`;
  }

  function extraAberto(item, campo) {
    return extrasVisiveis.has(extraId(item, campo));
  }

  function campoPrint(item, extra) {
    const valor = item[extra.campo] || "";
    if (extraAberto(item, extra.campo) || !valor.trim()) return "";
    const impresso = extra.campo === "anexo" ? anexoHtml(item.anexo) : esc(valor);
    return `<div class="ata-campo-print-only">
      <span class="ata-campo-print-label">${extra.rotulo}</span>
      <span class="ata-texto-print${extra.campo === "encaminhamentos" ? "" : " is-curto"}">${impresso}</span>
    </div>`;
  }

  function campoExtra(item, index, extra) {
    if (!extraAberto(item, extra.campo)) return campoPrint(item, extra);
    const valor = item[extra.campo] || "";
    const input = extra.tipo === "textarea"
      ? `<textarea data-campo="${extra.campo}" data-index="${index}" placeholder="${esc(extra.placeholder)}">${esc(valor)}</textarea>`
      : `<input type="${extra.tipo}" data-campo="${extra.campo}" data-index="${index}" maxlength="${extra.campo === "anexo" ? 500 : 240}" placeholder="${esc(extra.placeholder)}" value="${esc(valor)}" />`;
    const impresso = extra.campo === "anexo" ? anexoHtml(item.anexo) : esc(valor || "—");
    return `<div class="ata-campo-extra">
      <div class="ata-campo-head">
        <span>${extra.rotulo}</span>
        ${travada() ? "" : `<button type="button" class="ata-extra-fechar" data-fechar-campo="${extra.campo}" data-index="${index}" title="Recolher ${extra.rotulo}" aria-label="Recolher ${extra.rotulo}">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>`}
      </div>
      ${input}
      <span class="ata-texto-print${extra.campo === "encaminhamentos" ? "" : " is-curto"}">${impresso}</span>
    </div>`;
  }

  function botoesExtra(item, index) {
    if (travada()) return "";
    return `<div class="ata-extra-acoes">
      ${extraCampos.map((extra) => {
        const aberto = extraAberto(item, extra.campo);
        const preenchido = Boolean(String(item[extra.campo] || "").trim());
        return `<button type="button" class="ata-extra-btn${aberto ? " is-on" : ""}${preenchido ? " is-filled" : ""}" data-abrir-campo="${extra.campo}" data-index="${index}" aria-pressed="${aberto}" title="${aberto ? "Recolher" : "Adicionar"} ${extra.rotulo}">
          ${extra.svg}
          <span>${extra.rotulo}</span>
        </button>`;
      }).join("")}
    </div>`;
  }

  function renderItems() {
    const host = document.getElementById("ata-itens");
    document.getElementById("ata-vazio").hidden = draft.itens.length > 0;
    host.innerHTML = draft.itens
      .map((item, index) => {
        const meta = String(item.ref || "").startsWith("avulso-")
          ? (diversa() ? "Ponto" : "Pauta extra")
          : item.ref
            ? "Projeto"
            : [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
        return `<article class="ata-item">
          <header>
            <div>
              <p class="ata-kicker">${esc(meta || "Contrato")}</p>
              <h3>${esc(item.objeto)}</h3>
            </div>
            <div>
              ${item.tempo ? `<span class="ata-time">${esc(item.tempo)}</span>` : ""}
              <button type="button" class="linkish" data-remove="${index}">Tirar</button>
            </div>
          </header>
          <div class="ata-campos">
            <label>O que foi falado
              <textarea data-campo="texto" data-index="${index}" placeholder="O que foi falado sobre este ${item.ref ? "ponto" : "objeto"}">${esc(item.texto || "")}</textarea>
              <span class="ata-texto-print">${esc(item.texto || "")}</span>
            </label>
            ${extraCampos.map((extra) => campoExtra(item, index, extra)).join("")}
            ${botoesExtra(item, index)}
          </div>
        </article>`;
      })
      .join("");
    aplicarTrava();
  }

  function suggestions(query) {
    const list = document.getElementById("ata-sugestoes");
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (comite() || diversa()) {
      const projetos = fontePauta();
      if (comite() && term.length >= 2 && !projetos.length) {
        Comite.load().then(() => {
          if (document.getElementById("ata-busca").value.trim().toLocaleLowerCase("pt-BR") === term && Comite.projetos().length) suggestions(query);
        });
      }
      const achados = term.length < 2
        ? []
        : projetos.filter((projeto) => `${projeto.nome} ${projeto.id}`.toLocaleLowerCase("pt-BR").includes(term)).slice(0, 8);
      list.hidden = achados.length === 0;
      list.innerHTML = achados
        .map((projeto) => `<li><button type="button" data-add-projeto="${esc(projeto.id)}"><strong>${esc(projeto.nome)}</strong> — ${projeto.avulso ? "Ponto da pauta" : `${projeto.itens.length} itens em aberto`}</button></li>`)
        .join("");
      return;
    }
    if (term.length < 2 || !state.rows.length) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    const found = state.rows
      .filter((row) => `${row.objeto} ${row.nup} ${row.contrato} ${row.contratada}`.toLocaleLowerCase("pt-BR").includes(term))
      .slice(0, 8);
    list.hidden = found.length === 0;
    list.innerHTML = found
      .map((row) => `<li><button type="button" data-add="${esc(row.id)}"><strong>${esc(row.contrato || row.nup || "Contrato")}</strong> — ${esc(row.objeto)}</button></li>`)
      .join("");
  }

  function rotuloLista(ata) {
    const data = ata.data ? new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR") : "";
    const hora = String(ata.fim || "").replace("—", "").trim();
    return hora ? `${data} ${hora}` : data;
  }

  async function loadList() {
    const list = document.getElementById("ata-lista");
    try {
      const data = await api("GET", { tipo: draft.tipo });
      const atas = (data.atas || []).filter((ata) => tipoDe(ata.tipo) === tipoDe(draft.tipo));
      if (!data.versao && tipoDe(draft.tipo) === "diversa") {
        note('A função "ata" publicada no Supabase é a versão antiga: ela não lista nem grava reuniões diversas. Publique a versão nova da função.', true);
      }
      list.innerHTML = atas.length
        ? atas
            .map((ata) => {
              const current = ata.id === draft.id ? " is-on" : "";
              const who = ata.responsavel_nome ? `Responsável: ${ata.responsavel_nome}` : ata.autor_nome || "";
              return `<li class="ata-salva-item"><button type="button" class="ata-open${current}" data-open="${esc(ata.id)}"><strong>${esc(rotuloLista(ata))}</strong> ${esc(ata.titulo)}<span>${esc(who)}</span></button><button type="button" class="btn-danger btn-small" data-delete="${esc(ata.id)}">Excluir</button></li>`;
            })
            .join("")
        : `<li class="hint">Nenhuma ata ${comite() ? "do Comitê Executivo" : diversa() ? "de reunião diversa" : "de contratos"} salva ainda.</li>`;
    } catch (error) {
      list.innerHTML = "";
      note(error.message, true);
    }
  }

  async function openAta(id) {
    try {
      const { ata } = await api("GET", { id });
      draft = {
        id: ata.id,
        tipo: tipoDe(ata.tipo),
        freqSessao: "",
        titulo: ata.titulo,
        data: ata.data,
        responsavel_nome: ata.responsavel_nome || "",
        participantes: ata.participantes,
        duracao: ata.duracao,
        inicio: ata.inicio || "",
        fim: ata.fim || "",
        itens: ata.itens.map((item) => ({
          ...item,
          key: item.ref ? `p:${item.ref}` : item.nup || item.objeto,
          responsaveis: item.responsaveis || "",
          encaminhamentos: item.encaminhamentos || "",
          anexo: item.anexo || "",
        })),
      };
      editando = false;
      pedindoToken = false;
      pendenteExcluir = null;
      extrasVisiveis.clear();
      semearExtras(draft.itens);
      saveDraft();
      aplicarTipo();
      fillMeta();
      renderItems();
      loadList();
      note(`Ata de ${new Date(`${ata.data}T12:00:00`).toLocaleDateString("pt-BR")} aberta. Ela está fechada para edição.`);
    } catch (error) {
      note(error.message, true);
    }
  }

  async function save() {
    readMeta();
    if (expired) return relogin();
    if (!draft.titulo || !draft.data) {
      note("Informe o título e a data da reunião.", true);
      return;
    }
    if (!draft.responsavel_nome) {
      note("Informe o responsável pela ata.", true);
      return;
    }
    if (travada()) {
      pedirToken();
      note("A ata está concluída. Use Editar ata e o token para alterar.", true);
      return;
    }
    const button = document.getElementById("ata-save");
    button.disabled = true;
    aplicarTempos();
    renderItems();
    draft.duracao = currentDuration() || "";
    const horas = fillHorarios();
    draft.inicio = horas.inicio;
    draft.fim = horas.fim;
    try {
      const resposta = await api("POST", null, {
        id: draft.id,
        tipo: draft.tipo,
        titulo: draft.titulo,
        data: draft.data,
        responsavel_nome: draft.responsavel_nome,
        participantes: draft.participantes || "",
        duracao: draft.duracao,
        inicio: draft.inicio,
        fim: draft.fim,
        itens: draft.itens.map(({ nup, contrato, contratada, objeto, tempo, texto, ref, responsaveis, encaminhamentos, anexo }) => ({
          nup, contrato, contratada, objeto, tempo, texto, ref: ref || "",
          responsaveis: responsaveis || "",
          encaminhamentos: encaminhamentos || "",
          anexo: anexo || "",
        })),
      });
      draft.id = resposta.id;
      editando = false;
      pedindoToken = false;
      pendenteExcluir = null;
      saveDraft();
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      if (!resposta.versao) {
        note(`Ata gravada às ${hora}, mas a função "ata" publicada no Supabase é a versão antiga e gravou como contratos. Publique a versão nova da função e conclua a ata de novo.`, true);
      } else if (tipoDe(resposta.tipo) !== tipoDe(draft.tipo)) {
        note(`Ata gravada às ${hora}, mas o banco registrou o tipo "${resposta.tipo || "vazio"}". Rode de novo o ata.sql no Supabase.`, true);
      } else {
        note(`Ata concluída às ${hora}. Os campos foram fechados.`);
      }
      loadList();
    } catch (error) {
      note(error.message, true);
    } finally {
      aplicarTrava();
    }
  }

  async function liberarEdicao(event) {
    event?.preventDefault();
    const token = document.getElementById("ata-token").value.trim();
    if (!token) {
      erroToken("Informe o token de edição.");
      return;
    }
    let response;
    try {
      response = await fetch("/api/validar-token", {
        method: "POST",
        headers: { "x-ata-token": token },
      });
    } catch (error) {
      erroToken("Não foi possível confirmar o token de edição.");
      return;
    }
    if (!response.ok) {
      erroToken(response.status === 404 ? "O token de edição só funciona no site publicado." : `O token não confere com o deste site (${location.host}).`);
      return;
    }
    sessionStorage.setItem(tokenKey, token);
    document.getElementById("ata-token").value = "";
    const alvo = pendenteExcluir;
    pendenteExcluir = null;
    pedindoToken = false;
    fecharToken();
    if (alvo) {
      aplicarTrava();
      return excluir(alvo);
    }
    editando = true;
    aplicarTrava();
    note("Edição liberada. Conclua de novo para fechar a ata.");
  }

  function pedirEdicao() {
    if (!draft.id) return;
    if (temToken()) {
      editando = true;
      pedindoToken = false;
      aplicarTrava();
      note("Edição liberada. Conclua de novo para fechar a ata.");
      return;
    }
    pedirToken();
  }

  function pedirExclusao(id) {
    const alvo = id || draft.id;
    if (!alvo) return;
    if (!temToken()) {
      pedirToken(alvo);
      note("Informe o token para excluir a ata.", true);
      return;
    }
    excluir(alvo);
  }

  async function excluir(id) {
    const alvo = id || draft.id;
    if (!alvo || !temToken()) return;
    if (!window.confirm("Excluir esta ata salva? Essa ação não desfaz.")) return;
    const button = document.getElementById("ata-delete");
    button.disabled = true;
    try {
      await api("DELETE", { id: alvo });
      if (draft.id === alvo) {
        draft = emptyDraft(draft.tipo);
        editando = true;
        saveDraft();
        fillMeta();
        renderItems();
      }
      loadList();
      note("Ata excluída.");
    } catch (error) {
      note(error.message, true);
    } finally {
      button.disabled = false;
      aplicarTrava();
    }
  }

  function xml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function paragrafo(texto, opcoes = {}) {
    const negrito = opcoes.negrito ? "<w:b/>" : "";
    const cor = opcoes.cor ? `<w:color w:val="${opcoes.cor}"/>` : "";
    const tamanho = opcoes.tamanho || "22";
    const depois = opcoes.depois == null ? "40" : opcoes.depois;
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${depois}"/></w:pPr><w:r><w:rPr>${negrito}${cor}<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="${tamanho}"/></w:rPr><w:t xml:space="preserve">${xml(texto)}</w:t></w:r></w:p>`;
  }

  function celula(conteudo, fill, borda, span, largura) {
    const fundo = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
    const cor = borda || "C8CACB";
    const lado = ["top", "left", "bottom", "right"]
      .map((nome) => `<w:${nome} w:val="single" w:sz="4" w:space="0" w:color="${cor}"/>`)
      .join("");
    const colunas = span ? `<w:gridSpan w:val="${span}"/>` : "";
    const medida = largura ? `<w:tcW w:w="${largura}" w:type="dxa"/>` : "";
    return `<w:tc><w:tcPr>${medida}${colunas}<w:vAlign w:val="top"/>${fundo}<w:tcBorders>${lado}</w:tcBorders><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>${conteudo}</w:tc>`;
  }

  function tabela(linhas) {
    const grade = [3200, 1800, 3200, 2000].map((largura) => `<w:gridCol w:w="${largura}"/>`).join("");
    return `<w:tbl><w:tblPr><w:tblW w:w="10200" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid>${grade}</w:tblGrid>${linhas
      .map((celulas) => `<w:tr>${celulas.join("")}</w:tr>`)
      .join("")}</w:tbl>`;
  }

  function campo(rotulo, valor, fill, borda, valorCor, largura, span) {
    return celula(
      paragrafo(rotulo, { tamanho: "16", cor: "6D6E71", depois: "40" }) +
        paragrafo(valor || "—", { negrito: true, cor: valorCor || "4D4D4D", depois: "0" }),
      fill || "FFFFFF",
      borda,
      span,
      largura,
    );
  }

  async function baixarDocx() {
    readMeta();
    if (typeof JSZip === "undefined") {
      note("Não foi possível gerar o arquivo Word.", true);
      return;
    }
    const ehComite = comite();
    const ehDiversa = diversa();
    const rotuloItem = ehComite ? "Projeto" : ehDiversa ? "Ponto" : "Contrato";
    const blocos = [
      paragrafo(ehComite ? "Ata do Comitê Executivo" : ehDiversa ? "Ata da reunião diversa" : "Ata da reunião de contratos", { negrito: true, tamanho: "32", cor: "4D4D4D", depois: "80" }),
      paragrafo(`Descreva o que foi falado sobre cada ${ehComite || ehDiversa ? "ponto" : "objeto"}.`, { tamanho: "18", cor: "6D6E71", depois: "160" }),
    ];
    const horas = fillHorarios();
    const linhas = [[
      campo("TÍTULO", draft.titulo, "FFFFFF", "C8CACB", "4D4D4D", 3200),
      campo("DATA", dataBR(draft.data), "FFFFFF", "C8CACB", "4D4D4D", 1800),
      campo("RESPONSÁVEL", draft.responsavel_nome, "FFFFFF", "C8CACB", "4D4D4D", 3200),
      campo("DURAÇÃO", currentDuration() || draft.duracao, "E8F7EA", "B7E0BE", "2F9A3D", 2000),
    ], [
      campo("INÍCIO", horas.inicio, "E8F7EA", "B7E0BE", "2F9A3D", 5000, 2),
      campo("FIM", horas.fim, "E8F7EA", "B7E0BE", "2F9A3D", 5200, 2),
    ], [
      celula(
        paragrafo("PARTICIPANTES", { tamanho: "16", cor: "6D6E71", depois: "60" }) +
          paragrafo(nomesSalvos().join(", ") || "Nenhuma presença registrada nesta data.", { negrito: true, depois: "0" }),
        "E6F7F5",
        "B7E0DA",
        4,
      ),
    ]];
    draft.itens.forEach((item) => {
      const meta = String(item.ref || "").startsWith("avulso-")
        ? (ehDiversa ? "Ponto" : "Pauta extra")
        : item.ref
          ? "Projeto"
          : [item.contrato, item.contratada, item.nup].filter(Boolean).join(" · ");
      const partes = String(item.texto || "").split(/\n/);
      const texto = (partes.some((linha) => linha.trim()) ? partes : [" "])
        .map((linha) => paragrafo(linha, { depois: "40" }))
        .join("");
      linhas.push([
        celula(
          paragrafo(meta || rotuloItem, { tamanho: "16", cor: "6D6E71", depois: "40" }) +
            paragrafo(item.objeto || rotuloItem, { negrito: true, depois: "0" }),
          "E6F3FB",
          "C5DFF0",
          3,
          8200,
        ),
        celula(
          paragrafo(item.tempo || "", { negrito: true, cor: "2F9A3D", depois: "0" }),
          "E8F7EA",
          "B7E0BE",
          null,
          2000,
        ),
      ]);
      linhas.push([celula(texto, "FFFFFF", "C8CACB", 4)]);
      const extra = [
        ["RESPONSÁVEIS", item.responsaveis],
        ["ENCAMINHAMENTOS", item.encaminhamentos],
        ["ANEXO", item.anexo],
      ].filter(([, valor]) => String(valor || "").trim());
      extra.forEach(([rotulo, valor]) => {
        linhas.push([
          celula(
            paragrafo(rotulo, { tamanho: "16", cor: "6D6E71", depois: "40" }) +
              paragrafo(valor, { depois: "0" }),
            "FFFFFF",
            "C8CACB",
            4,
          ),
        ]);
      });
    });
    blocos.push(tabela(linhas));
    if (!draft.itens.length) blocos.push(paragrafo(ehComite ? "Nenhum projeto nesta ata." : ehDiversa ? "Nenhum ponto nesta ata." : "Nenhum objeto nesta ata.", { cor: "6D6E71" }));
    const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${blocos.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="851" w:right="851" w:bottom="851" w:left="851"/></w:sectPr></w:body>
</w:document>`;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.folder("word").file("document.xml", documento);
    const blob = await zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const link = document.createElement("a");
    const nome = `${nomeAta()}.docx`;
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function boot() {
    if (!(await SSO.exigirLogin())) return;
    document.getElementById("atalhos-reuniao").addEventListener("click", (event) => {
      const button = event.target.closest("[data-atalho]");
      if (button) irAtalho(button.dataset.atalho);
    });
    document.getElementById("menu-toggle").addEventListener("click", () => toggleMenu());
    document.getElementById("menu-list").addEventListener("click", (event) => {
      const button = event.target.closest(".view-tab");
      if (button) show(button.dataset.view);
    });
    document.getElementById("view-inicio").addEventListener("click", (event) => {
      const card = event.target.closest("[data-go]");
      if (card) show(card.dataset.go);
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".view-menu")) toggleMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || document.getElementById("menu-list").hidden) return;
      toggleMenu(false);
      document.getElementById("menu-toggle").focus();
    });

    ["ata-titulo", "ata-responsavel"].forEach((id) => {
      document.getElementById(id).addEventListener("input", readMeta);
    });
    document.getElementById("ata-data").addEventListener("change", async () => {
      statusFrequencia("");
      draft.titulo = document.getElementById("ata-titulo").value.trim();
      draft.data = document.getElementById("ata-data").value;
      draft.responsavel_nome = document.getElementById("ata-responsavel").value.trim();
      try {
        await Frequencia.load();
      } catch (err) {
        /* renderParticipantes mostra o erro */
      }
      const sessao = Frequencia.sessaoProxima(draft.data, horariosAtuais().inicio);
      draft.freqSessao = sessao?.id || "";
      const people = Frequencia.presentes(draft.data, draft.freqSessao) || [];
      draft.participantes = people.map((pessoa) => pessoa.nome).join(", ");
      saveDraft();
      fillHorarios();
      renderParticipantes();
    });
    document.getElementById("ata-participantes-lista").addEventListener("change", readMeta);
    document.getElementById("ata-presenca-recente").addEventListener("click", () => {
      const ultima = Frequencia.ultimaSessao();
      if (!ultima) return;
      draft.freqSessao = ultima.id;
      const input = document.getElementById("ata-data");
      input.value = ultima.data;
      input.dispatchEvent(new Event("change"));
    });
    document.getElementById("ata-freq-atualizar").addEventListener("click", atualizarFrequencia);
    document.getElementById("ata-freq-sessao").addEventListener("change", (event) => {
      statusFrequencia("");
      draft.freqSessao = event.target.value;
      if (!draft.id) {
        const people = Frequencia.presentes(draft.data, draft.freqSessao) || [];
        draft.participantes = people.map((pessoa) => pessoa.nome).join(", ");
      }
      saveDraft();
      renderParticipantes();
    });

    document.getElementById("ata-tipo").addEventListener("change", (event) => trocarTipo(event.target.value));

    document.getElementById("ata-from-checks").addEventListener("click", async () => {
      if (comite() && Comite.meeting().checks.size) await Comite.load();
      const added = bringChecks();
      if (!added && !marcados().size) {
        const empty = document.getElementById("ata-vazio");
        empty.hidden = false;
        empty.textContent = comite() || diversa()
          ? "Nenhum ponto foi marcado como discutido nesta reunião."
          : "Nenhum contrato foi marcado como lido nesta reunião.";
      }
    });

    document.getElementById("ata-busca").addEventListener("input", (event) => suggestions(event.target.value));
    document.getElementById("ata-sugestoes").addEventListener("click", (event) => {
      const projetoBtn = event.target.closest("button[data-add-projeto]");
      if (projetoBtn) {
        const projeto = fontePauta().find((item) => item.id === projetoBtn.dataset.addProjeto);
        if (!projeto) return;
        addProjeto(projeto);
        saveDraft();
        renderItems();
        document.getElementById("ata-busca").value = "";
        suggestions("");
        return;
      }
      const button = event.target.closest("button[data-add]");
      if (!button) return;
      const row = state.rows.find((item) => item.id === button.dataset.add);
      if (!row) return;
      addRow(row);
      saveDraft();
      renderItems();
      document.getElementById("ata-busca").value = "";
      suggestions("");
    });

    const items = document.getElementById("ata-itens");
    items.addEventListener("input", (event) => {
      const field = event.target.closest("[data-campo]");
      if (!field) return;
      const item = draft.itens[Number(field.dataset.index)];
      if (!item) return;
      item[field.dataset.campo] = field.value;
      saveDraft();
    });
    items.addEventListener("click", (event) => {
      const extraBtn = event.target.closest("button[data-abrir-campo], button[data-fechar-campo]");
      if (extraBtn) {
        const campo = extraBtn.dataset.abrirCampo || extraBtn.dataset.fecharCampo;
        const item = draft.itens[Number(extraBtn.dataset.index)];
        if (!item || travada()) return;
        const id = extraId(item, campo);
        if (extrasVisiveis.has(id)) extrasVisiveis.delete(id);
        else extrasVisiveis.add(id);
        renderItems();
        if (extrasVisiveis.has(id)) {
          document.querySelector(`[data-campo="${campo}"][data-index="${extraBtn.dataset.index}"]`)?.focus();
        }
        return;
      }
      const button = event.target.closest("button[data-remove]");
      if (!button) return;
      draft.itens.splice(Number(button.dataset.remove), 1);
      saveDraft();
      renderItems();
    });

    document.getElementById("ata-lista").addEventListener("click", (event) => {
      const remove = event.target.closest("button[data-delete]");
      if (remove) {
        pedirExclusao(remove.dataset.delete);
        return;
      }
      const button = event.target.closest("button[data-open]");
      if (button) openAta(button.dataset.open);
    });

    document.getElementById("ata-new").addEventListener("click", () => {
      draft = emptyDraft(draft.tipo);
      editando = true;
      pedindoToken = false;
      pendenteExcluir = null;
      extrasVisiveis.clear();
      saveDraft();
      fillMeta();
      aplicarTipo();
      renderItems();
      loadList();
    });

    document.getElementById("ata-print").addEventListener("click", () => {
      readMeta();
      fillHorarios();
      document.querySelectorAll(".ata-print-value[data-print]").forEach((span) => {
        const field = document.getElementById(span.dataset.print);
        const value = field && field.value;
        span.textContent = span.dataset.print === "ata-data" && value ? dataBR(value) : value || "—";
      });
      document.querySelectorAll(".ata-item [data-campo]").forEach((field) => {
        const box = field.parentElement.querySelector(".ata-texto-print");
        if (!box) return;
        if (field.dataset.campo === "anexo") box.innerHTML = anexoHtml(field.value);
        else box.textContent = field.value.trim() || "—";
      });
      const nomes = [...document.querySelectorAll("#ata-participantes-lista .freq-check")];
      nomes.forEach((label) => label.classList.remove("is-ultimo"));
      nomes.filter((label) => label.querySelector("input")?.checked).at(-1)?.classList.add("is-ultimo");
      const titulo = document.title;
      document.title = nomeAta();
      document.body.classList.add("printing-ata");
      window.print();
      window.addEventListener("afterprint", () => {
        document.title = titulo;
      }, { once: true });
    });
    document.getElementById("ata-docx").addEventListener("click", baixarDocx);
    window.addEventListener("afterprint", () => document.body.classList.remove("printing-ata"));

    document.getElementById("ata-save").addEventListener("click", save);
    document.getElementById("ata-edit").addEventListener("click", pedirEdicao);
    document.getElementById("ata-delete").addEventListener("click", () => pedirExclusao());
    document.getElementById("ata-token-form").addEventListener("submit", liberarEdicao);
    document.getElementById("ata-token-cancel").addEventListener("click", fecharToken);
    document.getElementById("ata-token-close").addEventListener("click", fecharToken);
    const tokenDialog = document.getElementById("ata-token-dialog");
    tokenDialog.addEventListener("cancel", () => {
      pedindoToken = false;
      pendenteExcluir = null;
    });
    tokenDialog.addEventListener("click", (event) => {
      if (event.target === tokenDialog) fecharToken();
    });

    const vista = sessionStorage.getItem("set-vista");
    sessionStorage.removeItem("set-vista");
    if (sessionStorage.getItem(returnKey) || vista === "ata") {
      sessionStorage.removeItem(returnKey);
      show("ata");
    } else if (vista === "frequencia" || vista === "comite" || vista === "diversa" || vista === "painel" || vista === "inicio") {
      show(vista);
    } else {
      aplicarTipo();
      fillMeta();
      show("inicio");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
  return {
    show,
    api,
    prepararTipo,
    definirTitulo,
    atualizarHorarios() {
      const duracao = document.getElementById("ata-duracao");
      if (duracao) duracao.value = currentDuration() || "Reunião não iniciada";
      fillHorarios();
      pintarAtalhos();
    },
  };
})();

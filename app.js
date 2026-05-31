(() => {
  const STORAGE_KEY = "fincabot-state-v2";
  const CLOUD_CONFIG_KEY = "fincabot-cloud-config-v1";
  const viewTitles = {
    dashboard: "Resumen",
    assistant: "Asistente",
    crops: "Cultivos",
    orders: "Pedidos",
    team: "Equipo",
    tasks: "Tareas",
    products: "Productos",
    photo: "Foto",
    settings: "Ajustes"
  };

  let state = ensureState(loadLocalState() || seedState());
  let weather = { status: "idle" };
  let sheetSyncState = { status: "idle", message: "" };
  let notificationTimer = null;
  let supabaseClient = null;
  let supabaseConfigSignature = "";
  let cloudSession = null;
  let cloudFarmId = null;
  let cloudChannel = null;
  let cloudSyncTimer = null;
  let cloudSyncing = false;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    registerServiceWorker();
    setupNavigation();
    setupForms();
    setupButtons();
    window.addEventListener("supabase-ready", initCloud);
    render();
    initCloud();
    loadWeather();
    if (state.settings.appsScriptUrl) syncAppSheetNow(false);
    scheduleDailyNotification();
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function todayISO() {
    return toISO(new Date());
  }

  function toISO(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function parseISO(value) {
    if (!value) return parseISO(todayISO());
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(iso, days) {
    const date = parseISO(iso);
    date.setDate(date.getDate() + days);
    return toISO(date);
  }

  function daysBetween(from, to) {
    const start = parseISO(from);
    const end = parseISO(to);
    return Math.floor((end - start) / 86400000);
  }

  function formatDate(iso) {
    if (!iso) return "sin fecha";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(parseISO(iso));
  }

  function minutesFromTime(value) {
    const [hours, minutes] = (value || "07:00").split(":").map(Number);
    return hours * 60 + minutes;
  }

  function timeFromMinutes(total) {
    const minutes = ((total % 1440) + 1440) % 1440;
    const h = Math.floor(minutes / 60).toString().padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function seedState() {
    const today = todayISO();
    return {
      version: 2,
      meta: { updatedAt: new Date().toISOString() },
      settings: {
        farmName: "Mi finca",
        lat: "",
        lon: "",
        workStart: "07:00",
        workEnd: "16:00",
        restEveryMinutes: 180,
        breakMinutes: 20,
        notifyHour: "06:45",
        notificationsEnabled: false,
        appsScriptUrl: "",
        appsScriptToken: "",
        sheetProductsTab: "PRODUCTOS",
        sheetOrdersTab: "VENTA",
        sheetSaleLinesTab: "VENTAS",
        sheetClientsTab: "CLIENTES",
        sheetHarvestTab: "LISTA RECOLECTA"
      },
      people: [
        {
          id: uid("person"),
          name: "Angel",
          minutes: 420,
          skills: ["recoleccion", "riego", "tratamientos", "hierbas", "arreglos"],
          active: true
        }
      ],
      crops: [],
      orders: [],
      harvestList: [],
      fieldSections: [],
      products: [],
      tasks: [
        {
          id: uid("task"),
          title: "Revisar goteros del sector norte",
          type: "repair",
          dueDate: addDays(today, 2),
          estimateMinutes: 50,
          priority: 2,
          notes: "Mirar presion y juntas",
          status: "todo"
        }
      ],
      observations: [],
      chat: [
        {
          role: "assistant",
          text: "Estoy listo. Puedo organizar el dia con pedidos, riego, tratamientos, hierbas, arreglos y tiempo disponible.",
          at: new Date().toISOString()
        }
      ],
      learning: {}
    };
  }

  function ensureState(input) {
    const base = seedState();
    const merged = {
      ...base,
      ...input,
      settings: { ...base.settings, ...(input?.settings || {}) },
      meta: { ...base.meta, ...(input?.meta || {}) },
      people: Array.isArray(input?.people) ? input.people : base.people,
      crops: Array.isArray(input?.crops) ? input.crops : base.crops,
      orders: Array.isArray(input?.orders) ? input.orders : base.orders,
      harvestList: Array.isArray(input?.harvestList) ? input.harvestList : base.harvestList,
      fieldSections: Array.isArray(input?.fieldSections) ? input.fieldSections : base.fieldSections,
      products: Array.isArray(input?.products) ? input.products : base.products,
      tasks: Array.isArray(input?.tasks) ? input.tasks : base.tasks,
      observations: Array.isArray(input?.observations) ? input.observations : base.observations,
      chat: Array.isArray(input?.chat) ? input.chat : base.chat,
      learning: input?.learning || {}
    };

    merged.people = merged.people.map((person) => ({
      id: person.id || uid("person"),
      name: person.name || "Persona",
      minutes: Number(person.minutes) || 360,
      skills: Array.isArray(person.skills) ? person.skills : ["general"],
      active: person.active !== false
    }));
    merged.crops = merged.crops.map((crop) => ({
      id: crop.id || uid("crop"),
      name: crop.name || "Cultivo",
      plot: crop.plot || "Parcela",
      plants: Number(crop.plants) || 1,
      stage: crop.stage || "Crecimiento",
      waterEveryDays: Number(crop.waterEveryDays) || 2,
      weedEveryDays: Number(crop.weedEveryDays) || 10,
      lastWatered: crop.lastWatered || todayISO(),
      lastWeeded: crop.lastWeeded || todayISO(),
      yieldKgHour: Number(crop.yieldKgHour) || 12,
      source: crop.source === "purchased" ? "purchased" : "cultivated",
      purchaseLeadDays: Number(crop.purchaseLeadDays) || 3,
      available: crop.available !== false,
      externalId: crop.externalId || ""
    }));
    merged.orders = merged.orders.map((order) => ({
      id: order.id || uid("order"),
      client: order.client || "Cliente",
      cropId: order.cropId || merged.crops[0]?.id || "",
      kg: Number(order.kg) || 0,
      dueDate: order.dueDate || todayISO(),
      priority: Number(order.priority) || 2,
      status: order.status || "pending",
      zone: order.zone || "other",
      deliveryMethod: order.deliveryMethod || "auto",
      externalId: order.externalId || ""
    }));
    merged.harvestList = merged.harvestList.map((item) => ({
      id: item.id || uid("harvest"),
      cropId: item.cropId || "",
      productName: item.productName || "",
      kg: Number(item.kg) || 0,
      units: Number(item.units) || 0,
      dueDate: item.dueDate || todayISO(),
      relation: item.relation || "",
      status: item.status || "pending",
      externalId: item.externalId || ""
    }));
    merged.fieldSections = merged.fieldSections.map((section) => ({
      id: section.id || uid("section"),
      name: section.name || "Seccion",
      notes: section.notes || "",
      rivers: Array.isArray(section.rivers) ? section.rivers.map((river) => ({
        id: river.id || uid("river"),
        name: river.name || "Rio",
        capacityPlants: Number(river.capacityPlants) || 1,
        cropId: river.cropId || "",
        plantedPlants: Number(river.plantedPlants) || 0,
        plantedAt: river.plantedAt || todayISO(),
        notes: river.notes || ""
      })) : []
    }));
    merged.products = merged.products.map((product) => ({
      id: product.id || uid("product"),
      name: product.name || "Producto",
      cropId: product.cropId || merged.crops[0]?.id || "",
      dose: product.dose || "",
      frequencyDays: Number(product.frequencyDays) || 14,
      lastApplied: product.lastApplied || todayISO(),
      notes: product.notes || "",
      active: product.active !== false
    }));
    merged.tasks = merged.tasks.map((task) => ({
      id: task.id || uid("task"),
      title: task.title || "Tarea",
      type: task.type || "general",
      dueDate: task.dueDate || todayISO(),
      estimateMinutes: Number(task.estimateMinutes) || 30,
      priority: Number(task.priority) || 2,
      notes: task.notes || "",
      status: task.status || "todo"
    }));
    return merged;
  }

  function saveState(options = {}) {
    state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (options.render !== false) render();
    if (options.sync !== false) queueCloudSync();
    scheduleDailyNotification();
  }

  function setupNavigation() {
    all("[data-nav] .nav-button").forEach((button) => {
      button.addEventListener("click", () => showView(button.dataset.view));
    });
  }

  function showView(view) {
    all(".view").forEach((section) => section.classList.toggle("is-active", section.id === `view-${view}`));
    all("[data-nav] .nav-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === view);
    });
    byId("viewTitle").textContent = viewTitles[view] || "FincaBot";
    if (view === "assistant") setTimeout(scrollChatToBottom, 0);
  }

  function setupForms() {
    byId("cropForm").addEventListener("submit", handleCropSubmit);
    byId("fieldSectionForm").addEventListener("submit", handleFieldSectionSubmit);
    byId("fieldRiverForm").addEventListener("submit", handleFieldRiverSubmit);
    byId("orderForm").addEventListener("submit", handleOrderSubmit);
    byId("personForm").addEventListener("submit", handlePersonSubmit);
    byId("taskForm").addEventListener("submit", handleTaskSubmit);
    byId("productForm").addEventListener("submit", handleProductSubmit);
    byId("settingsForm").addEventListener("submit", handleSettingsSubmit);
    byId("chatForm").addEventListener("submit", handleChatSubmit);
    byId("photoForm").addEventListener("submit", handlePhotoSubmit);
    byId("photoInput").addEventListener("change", previewPhoto);
    byId("importInput").addEventListener("change", importMemory);

    byId("cancelCropEdit").addEventListener("click", resetCropForm);
    byId("cancelSectionEdit").addEventListener("click", resetFieldSectionForm);
    byId("cancelRiverEdit").addEventListener("click", resetFieldRiverForm);
    byId("cancelOrderEdit").addEventListener("click", resetOrderForm);
    byId("cancelPersonEdit").addEventListener("click", resetPersonForm);
    byId("cancelTaskEdit").addEventListener("click", resetTaskForm);
    byId("cancelProductEdit").addEventListener("click", resetProductForm);
  }

  function setupButtons() {
    document.body.addEventListener("click", handleActionClick);
    byId("refreshWeatherBtn").addEventListener("click", loadWeather);
    byId("notifyBtn").addEventListener("click", enableNotifications);
    byId("testNotifyBtn").addEventListener("click", () => showDailyNotification(true));
    byId("copyPlanBtn").addEventListener("click", copyPlanSummary);
    byId("clearChatBtn").addEventListener("click", () => {
      state.chat = [];
      saveState();
    });
    byId("exportBtn").addEventListener("click", exportMemory);
    byId("resetBtn").addEventListener("click", resetDemo);
    byId("quickActions").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-prompt]");
      if (!button) return;
      byId("chatInput").value = button.dataset.prompt;
      runAssistant(button.dataset.prompt);
    });
    byId("cloudLoginBtn").addEventListener("click", handleCloudLogin);
    byId("cloudSyncBtn").addEventListener("click", () => syncCloudNow(true));
    byId("cloudLogoutBtn").addEventListener("click", handleCloudLogout);
    byId("sheetSyncBtn").addEventListener("click", () => syncAppSheetNow(true));
  }

  function render() {
    const plan = buildDailyPlan();
    byId("farmNameLabel").textContent = state.settings.farmName || "Asistente agricola";
    byId("todayLabel").textContent = new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      day: "2-digit",
      month: "long"
    }).format(new Date());

    renderStats(plan);
    renderAdvice(plan);
    renderWeather();
    renderSchedule(plan);
    renderCropMap();
    renderHarvestPurchaseBoard(plan);
    renderCropOptions();
    renderFieldOptions();
    renderCrops();
    renderFieldPlan();
    renderOrders();
    renderTeam();
    renderTasks();
    renderProducts();
    renderObservations();
    renderChat();
    fillSettingsForm();
    updateSheetStatus();
    updateCloudStatus();
  }

  function renderStats(plan) {
    const dueOrders = state.orders.filter((order) => order.status !== "done" && order.dueDate <= todayISO());
    const kg = dueOrders.reduce((sum, order) => sum + Number(order.kg || 0), 0);
    const waterCount = plan.items.filter((item) => item.action === "water").length;
    const purchaseCount = plan.items.filter((item) => item.action === "purchase").length;
    const totalMinutes = plan.items.reduce((sum, item) => sum + item.minutes, 0);
    byId("todayStats").innerHTML = [
      statBox("Pedidos", dueOrders.length),
      statBox("Kg hoy", formatNumber(kg)),
      statBox("Comprar", purchaseCount),
      statBox("Trabajo", `${totalMinutes} min`)
    ].join("");
  }

  function statBox(label, value) {
    return `<div class="stat-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderAdvice(plan) {
    const main = plan.items[0];
    const overflow = plan.overflow.reduce((sum, item) => sum + item.remaining, 0);
    const weatherLine = weather.status === "ready"
      ? `Max ${Math.round(weather.tempMax)} C, lluvia ${Math.round(weather.rainProbability)}%.`
      : "Clima pendiente de coordenadas.";
    const mainLine = main
      ? `Primero: ${main.title}.`
      : "No hay bloque critico para hoy.";
    const overflowLine = overflow > 0
      ? `Faltan ${overflow} min por colocar; baja arreglos o suma ayuda.`
      : "La jornada entra en el tiempo disponible.";
    byId("dailyAdvice").innerHTML = `<strong>${escapeHtml(mainLine)}</strong><span>${escapeHtml(weatherLine)} ${escapeHtml(overflowLine)}</span>`;
  }

  function renderWeather() {
    const target = byId("weatherSummary");
    if (weather.status === "missing") {
      target.innerHTML = `
        <div class="weather-card muted">
          <strong>Sin coordenadas</strong>
          <span>Configura latitud y longitud para calcular lluvia, calor y viento.</span>
        </div>`;
      return;
    }
    if (weather.status === "loading") {
      target.innerHTML = `<div class="weather-card muted"><strong>Actualizando</strong><span>Consultando Open-Meteo.</span></div>`;
      return;
    }
    if (weather.status === "error") {
      target.innerHTML = `<div class="weather-card risk-high"><strong>Clima no disponible</strong><span>${escapeHtml(weather.message || "Revisa la conexion.")}</span></div>`;
      return;
    }
    if (weather.status !== "ready") {
      target.innerHTML = `<div class="weather-card muted"><strong>Clima</strong><span>Pendiente de actualizar.</span></div>`;
      return;
    }

    const risk = getWeatherRisk();
    target.innerHTML = `
      <div class="weather-card ${risk.className}">
        <strong>${escapeHtml(risk.label)}</strong>
        <span>${Math.round(weather.tempMax)} C max · ${Math.round(weather.rainProbability)}% lluvia · ${Math.round(weather.windMax)} km/h viento</span>
      </div>
      <div class="risk-bars">
        ${riskBar("Calor", Math.min(100, Math.max(0, weather.tempMax * 2.5)))}
        ${riskBar("Lluvia", weather.rainProbability)}
        ${riskBar("Viento", Math.min(100, weather.windMax * 3))}
      </div>`;
  }

  function riskBar(label, value) {
    return `
      <div class="risk-bar">
        <span>${escapeHtml(label)}</span>
        <div><i style="width:${Math.round(value)}%"></i></div>
      </div>`;
  }

  function getWeatherRisk() {
    if (weather.status !== "ready") return { label: "Sin datos", className: "muted" };
    if (weather.rainProbability >= 70 || weather.windMax >= 35) {
      return { label: "Riesgo alto", className: "risk-high" };
    }
    if (weather.tempMax >= 30 || weather.rainProbability >= 45) {
      return { label: "Atencion", className: "risk-medium" };
    }
    return { label: "Bueno para campo", className: "risk-low" };
  }

  function renderSchedule(plan) {
    const board = byId("scheduleBoard");
    if (!plan.lanes.length) {
      board.innerHTML = `<div class="empty-state">Anade personas al equipo para organizar el dia.</div>`;
      return;
    }
    board.innerHTML = plan.lanes.map((lane) => `
      <article class="lane-card">
        <div class="lane-head">
          <strong>${escapeHtml(lane.person.name)}</strong>
          <span>${lane.used} / ${lane.person.minutes} min</span>
        </div>
        <div class="timeline">
          ${lane.blocks.length ? lane.blocks.map(renderBlock).join("") : `<div class="empty-state compact">Sin tareas asignadas.</div>`}
        </div>
      </article>
    `).join("") + renderOverflow(plan.overflow);
  }

  function renderBlock(block) {
    if (block.type === "break") {
      return `<div class="time-block rest"><span>${block.start} - ${block.end}</span><strong>Descanso</strong></div>`;
    }
    return `
      <div class="time-block ${escapeHtml(block.item.action)}">
        <span>${block.start} - ${block.end} · ${block.item.minutes} min</span>
        <strong>${escapeHtml(block.item.title)}</strong>
        <small>${escapeHtml(block.item.detail)}</small>
        <button class="mini-button" data-action="complete-plan" data-id="${escapeHtml(block.item.id)}">Hecho</button>
      </div>`;
  }

  function renderOverflow(items) {
    if (!items.length) return "";
    return `
      <article class="lane-card overflow-card">
        <div class="lane-head"><strong>Sin colocar</strong><span>${items.reduce((sum, item) => sum + item.remaining, 0)} min</span></div>
        <div class="timeline">
          ${items.map((item) => `<div class="time-block overflow"><strong>${escapeHtml(item.title)}</strong><small>Faltan ${item.remaining} min</small></div>`).join("")}
        </div>
      </article>`;
  }

  function renderCropMap() {
    const today = todayISO();
    byId("cropMap").innerHTML = state.crops.map((crop) => {
      const isPurchased = crop.source === "purchased";
      const waterDue = !isPurchased && daysBetween(crop.lastWatered, today) >= crop.waterEveryDays;
      const weedDue = !isPurchased && daysBetween(crop.lastWeeded, today) >= crop.weedEveryDays;
      const status = isPurchased ? "Comprar" : waterDue ? "Riego" : weedDue ? "Hierbas" : "OK";
      const className = isPurchased ? "needs-purchase" : waterDue ? "needs-water" : weedDue ? "needs-weed" : "ok";
      return `
        <article class="crop-tile ${className}">
          <div>
            <strong>${escapeHtml(crop.name)}</strong>
            <span>${escapeHtml(crop.plot)}</span>
          </div>
          <small>${sourceLabel(crop.source)} - ${escapeHtml(crop.stage)} - ${crop.plants} plantas</small>
          <b>${status}</b>
        </article>`;
    }).join("") || `<div class="empty-state">Anade cultivos para ver el mapa.</div>`;
  }

  function renderHarvestPurchaseBoard(plan) {
    const harvest = plan.items.filter((item) => item.action === "harvest");
    const purchases = plan.items.filter((item) => item.action === "purchase");
    const logistics = plan.items.filter((item) => item.action === "delivery");
    if (!state.settings.appsScriptUrl) {
      byId("harvestPurchaseBoard").innerHTML = `
        <div class="empty-state">
          Conecta PEDIDOS CAMPO en Ajustes. Sin esa URL no puedo leer pedidos, productos ni cultivos directamente de la base de datos.
        </div>`;
      return;
    }
    byId("harvestPurchaseBoard").innerHTML = [
      renderMiniLane("Recolectar", harvest, "No hay recoleccion pendiente."),
      renderMiniLane("Comprar", purchases, "No hay compras avisadas."),
      renderMiniLane("Reparto", logistics, "No hay reparto o agencia para hoy.")
    ].join("");
  }

  function renderMiniLane(title, items, empty) {
    return `
      <article class="lane-card">
        <div class="lane-head"><strong>${escapeHtml(title)}</strong><span>${items.length}</span></div>
        <div class="timeline">
          ${items.length ? items.map((item) => `
            <div class="time-block ${escapeHtml(item.action)}">
              <strong>${escapeHtml(item.title)}</strong>
              <small>${escapeHtml(item.detail)}</small>
            </div>
          `).join("") : `<div class="empty-state compact">${escapeHtml(empty)}</div>`}
        </div>
      </article>`;
  }

  function renderCropOptions() {
    const options = state.crops.map((crop) => `<option value="${escapeHtml(crop.id)}">${escapeHtml(crop.name)} - ${sourceLabel(crop.source)}</option>`).join("");
    ["orderCrop", "productCrop", "photoCrop"].forEach((id) => {
      const select = byId(id);
      if (!select) return;
      const previous = select.value;
      select.innerHTML = options || `<option value="">Sin cultivos</option>`;
      if (previous) select.value = previous;
    });
  }

  function renderFieldOptions() {
    const sectionOptions = state.fieldSections
      .map((section) => `<option value="${escapeHtml(section.id)}">${escapeHtml(section.name)}</option>`)
      .join("");
    const sectionSelect = byId("fieldRiverSection");
    const previousSection = sectionSelect.value;
    sectionSelect.innerHTML = sectionOptions || `<option value="">Crea una seccion</option>`;
    if (previousSection) sectionSelect.value = previousSection;

    const cropSelect = byId("fieldRiverCrop");
    const previousCrop = cropSelect.value;
    cropSelect.innerHTML = `<option value="">Sin cultivo</option>` + state.crops
      .filter((crop) => crop.source !== "purchased")
      .map((crop) => `<option value="${escapeHtml(crop.id)}">${escapeHtml(crop.name)}</option>`)
      .join("");
    if (previousCrop) cropSelect.value = previousCrop;
  }

  function renderFieldPlan() {
    const target = byId("fieldPlan");
    if (!state.fieldSections.length) {
      target.innerHTML = `<div class="empty-state">Crea una seccion para empezar el plano.</div>`;
      return;
    }
    target.innerHTML = state.fieldSections.map((section) => `
      <article class="field-section-card">
        <div class="field-section-head">
          <div>
            <strong>${escapeHtml(section.name)}</strong>
            <span>${escapeHtml(section.notes || `${section.rivers.length} rios`)}</span>
          </div>
          <div class="item-actions">
            <button class="icon-button" data-action="edit-section" data-id="${escapeHtml(section.id)}" title="Renombrar seccion" aria-label="Renombrar seccion">${icon("edit")}</button>
            <button class="icon-button danger" data-action="delete-section" data-id="${escapeHtml(section.id)}" title="Eliminar seccion" aria-label="Eliminar seccion">${icon("trash")}</button>
          </div>
        </div>
        <div class="river-grid">
          ${section.rivers.length ? section.rivers.map((river) => renderRiver(section, river)).join("") : `<div class="empty-state compact">Sin rios todavia.</div>`}
        </div>
      </article>
    `).join("");
  }

  function renderRiver(section, river) {
    const crop = findCrop(river.cropId);
    const fill = Math.min(100, Math.round((Number(river.plantedPlants || 0) / Math.max(1, Number(river.capacityPlants || 1))) * 100));
    return `
      <div class="river-row" style="--fill:${fill}%">
        <div class="river-main">
          <strong>${escapeHtml(river.name)}</strong>
          <span>${crop ? escapeHtml(crop.name) : "Sin cultivo"} - ${river.plantedPlants}/${river.capacityPlants} plantas</span>
          <small>Plantado ${formatDate(river.plantedAt)}${river.notes ? ` - ${escapeHtml(river.notes)}` : ""}</small>
        </div>
        <div class="river-actions">
          <button class="mini-button" data-action="edit-river" data-section="${escapeHtml(section.id)}" data-id="${escapeHtml(river.id)}">Editar</button>
          <button class="mini-button danger-mini" data-action="clear-river" data-section="${escapeHtml(section.id)}" data-id="${escapeHtml(river.id)}">Vaciar</button>
        </div>
      </div>`;
  }

  function renderCrops() {
    byId("cropList").innerHTML = state.crops.map((crop) => `
      <article class="item-card">
        <div>
          <strong>${escapeHtml(crop.name)}</strong>
          <span>${escapeHtml(crop.plot)} - ${escapeHtml(crop.stage)} - ${sourceLabel(crop.source)}</span>
          <small>${crop.source === "purchased" ? `Aviso compra ${crop.purchaseLeadDays} dias antes` : `Riego ${formatDate(crop.lastWatered)} - Hierbas ${formatDate(crop.lastWeeded)} - ${crop.yieldKgHour} kg/h`}</small>
        </div>
        <div class="item-actions">
          <button class="icon-button" data-action="mark-water" data-id="${escapeHtml(crop.id)}" title="Marcar riego" aria-label="Marcar riego">${icon("drop")}</button>
          <button class="icon-button" data-action="mark-weed" data-id="${escapeHtml(crop.id)}" title="Marcar hierbas" aria-label="Marcar hierbas">${icon("leaf")}</button>
          <button class="icon-button" data-action="edit-crop" data-id="${escapeHtml(crop.id)}" title="Editar" aria-label="Editar">${icon("edit")}</button>
          <button class="icon-button danger" data-action="delete-crop" data-id="${escapeHtml(crop.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
        </div>
      </article>
    `).join("") || `<div class="empty-state">No hay cultivos guardados.</div>`;
  }

  function renderOrders() {
    const today = todayISO();
    const sorted = [...state.orders].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.priority - a.priority);
    byId("orderList").innerHTML = sorted.map((order) => {
      const crop = findCrop(order.cropId);
      const isDue = order.status !== "done" && order.dueDate <= today;
      return `
        <article class="item-card ${isDue ? "due" : ""}">
          <div>
            <strong>${escapeHtml(order.client)}</strong>
            <span>${escapeHtml(crop?.name || "Producto")} - ${formatNumber(order.kg)} kg - ${formatDate(order.dueDate)}</span>
            <small>${priorityLabel(order.priority)} - ${sourceLabel(crop?.source)} - ${routeLabel(order.zone || "other")} - ${deliveryMethodLabel(order.deliveryMethod)}</small>
          </div>
          <div class="item-actions">
            <button class="icon-button" data-action="done-order" data-id="${escapeHtml(order.id)}" title="Completar" aria-label="Completar">${icon("check")}</button>
            <button class="icon-button" data-action="edit-order" data-id="${escapeHtml(order.id)}" title="Editar" aria-label="Editar">${icon("edit")}</button>
            <button class="icon-button danger" data-action="delete-order" data-id="${escapeHtml(order.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
          </div>
        </article>`;
    }).join("") || `<div class="empty-state">No hay pedidos.</div>`;
  }

  function renderTeam() {
    byId("teamList").innerHTML = state.people.map((person) => `
      <article class="item-card">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <span>${person.minutes} min disponibles · ${person.active ? "Activo" : "Inactivo"}</span>
          <small>${person.skills.map(skillLabel).join(", ")}</small>
        </div>
        <div class="item-actions">
          <button class="icon-button" data-action="toggle-person" data-id="${escapeHtml(person.id)}" title="Activar o pausar" aria-label="Activar o pausar">${icon("power")}</button>
          <button class="icon-button" data-action="edit-person" data-id="${escapeHtml(person.id)}" title="Editar" aria-label="Editar">${icon("edit")}</button>
          <button class="icon-button danger" data-action="delete-person" data-id="${escapeHtml(person.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
        </div>
      </article>
    `).join("") || `<div class="empty-state">Anade al menos una persona.</div>`;
  }

  function renderTasks() {
    const sorted = [...state.tasks].sort((a, b) => (a.status === "done") - (b.status === "done") || a.dueDate.localeCompare(b.dueDate));
    byId("taskList").innerHTML = sorted.map((task) => `
      <article class="item-card ${task.status === "done" ? "is-done" : ""}">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${taskTypeLabel(task.type)} · ${formatDate(task.dueDate)} · ${task.estimateMinutes} min</span>
          <small>${priorityLabel(task.priority)}${task.notes ? ` · ${escapeHtml(task.notes)}` : ""}</small>
        </div>
        <div class="item-actions">
          <button class="icon-button" data-action="done-task" data-id="${escapeHtml(task.id)}" title="Completar" aria-label="Completar">${icon("check")}</button>
          <button class="icon-button" data-action="edit-task" data-id="${escapeHtml(task.id)}" title="Editar" aria-label="Editar">${icon("edit")}</button>
          <button class="icon-button danger" data-action="delete-task" data-id="${escapeHtml(task.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
        </div>
      </article>
    `).join("") || `<div class="empty-state">No hay tareas manuales.</div>`;
  }

  function renderProducts() {
    byId("productList").innerHTML = state.products.map((product) => {
      const crop = findCrop(product.cropId);
      const due = daysBetween(product.lastApplied, todayISO()) >= product.frequencyDays;
      return `
        <article class="item-card ${due ? "due" : ""}">
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(crop?.name || "Cultivo")} · ${escapeHtml(product.dose)} · cada ${product.frequencyDays} dias</span>
            <small>Ultima aplicacion ${formatDate(product.lastApplied)}${product.notes ? ` · ${escapeHtml(product.notes)}` : ""}</small>
          </div>
          <div class="item-actions">
            <button class="icon-button" data-action="mark-product" data-id="${escapeHtml(product.id)}" title="Aplicado hoy" aria-label="Aplicado hoy">${icon("check")}</button>
            <button class="icon-button" data-action="edit-product" data-id="${escapeHtml(product.id)}" title="Editar" aria-label="Editar">${icon("edit")}</button>
            <button class="icon-button danger" data-action="delete-product" data-id="${escapeHtml(product.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
          </div>
        </article>`;
    }).join("") || `<div class="empty-state">No hay productos programados.</div>`;
  }

  function updateSheetStatus() {
    const node = byId("sheetStatus");
    if (!node) return;
    node.className = `sync-status ${sheetSyncState.status}`;
    if (!state.settings.appsScriptUrl) {
      node.textContent = "PEDIDOS CAMPO no conectado";
      return;
    }
    if (sheetSyncState.status === "syncing") {
      node.textContent = "Leyendo PEDIDOS CAMPO...";
      return;
    }
    if (sheetSyncState.status === "error") {
      node.textContent = `Error hoja: ${sheetSyncState.message}`;
      return;
    }
    const updated = state.meta?.sheetUpdatedAt ? ` - ${formatDate(state.meta.sheetUpdatedAt.slice(0, 10))}` : "";
    node.textContent = `PEDIDOS CAMPO conectado${updated}`;
  }

  function renderObservations() {
    const recent = [...state.observations].slice(-8).reverse();
    byId("observationList").innerHTML = recent.map((observation) => {
      const crop = findCrop(observation.cropId);
      return `
        <article class="item-card">
          <div>
            <strong>${escapeHtml(crop?.name || "Cultivo")} · ${symptomLabel(observation.symptom)}</strong>
            <span>${formatDate(observation.date)} · Severidad ${observation.severity}/3</span>
            <small>${escapeHtml(observation.notes || observation.recommendation)}</small>
          </div>
          <div class="item-actions">
            <button class="icon-button danger" data-action="delete-observation" data-id="${escapeHtml(observation.id)}" title="Eliminar" aria-label="Eliminar">${icon("trash")}</button>
          </div>
        </article>`;
    }).join("") || `<div class="empty-state">Las observaciones guardadas apareceran aqui.</div>`;
  }

  function renderChat() {
    const log = byId("chatLog");
    log.innerHTML = state.chat.slice(-60).map((message) => `
      <div class="chat-message ${message.role}">
        <span>${message.role === "user" ? "Tu" : "FincaBot"}</span>
        <p>${escapeHtml(message.text).replaceAll("\n", "<br>")}</p>
      </div>
    `).join("") || `<div class="empty-state compact">Pregunta algo para empezar.</div>`;
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    const log = byId("chatLog");
    log.scrollTop = log.scrollHeight;
  }

  function fillSettingsForm() {
    byId("settingFarmName").value = state.settings.farmName || "";
    byId("settingLat").value = state.settings.lat || "";
    byId("settingLon").value = state.settings.lon || "";
    byId("settingStart").value = state.settings.workStart || "07:00";
    byId("settingEnd").value = state.settings.workEnd || "16:00";
    byId("settingRestEvery").value = state.settings.restEveryMinutes || 180;
    byId("settingBreak").value = state.settings.breakMinutes || 20;
    byId("settingNotifyHour").value = state.settings.notifyHour || "06:45";
    byId("settingSheetUrl").value = state.settings.appsScriptUrl || "";
    byId("settingSheetToken").value = state.settings.appsScriptToken || "";
    byId("settingProductsTab").value = state.settings.sheetProductsTab || "PRODUCTOS";
    byId("settingOrdersTab").value = state.settings.sheetOrdersTab || "VENTA";
    byId("settingSaleLinesTab").value = state.settings.sheetSaleLinesTab || "VENTAS";
    byId("settingClientsTab").value = state.settings.sheetClientsTab || "CLIENTES";
    byId("settingHarvestTab").value = state.settings.sheetHarvestTab || "LISTA RECOLECTA";
    const cloud = loadCloudConfig();
    byId("settingSupabaseUrl").value = cloud.supabaseUrl || "";
    byId("settingSupabaseKey").value = cloud.supabaseAnonKey || "";
  }

  function buildDailyPlan() {
    syncCropPlantsFromFieldPlan();
    const today = todayISO();
    const items = [];

    const activeHarvestList = state.harvestList
      .filter((item) => item.status !== "done")
      .filter((item) => item.dueDate <= today)
      .filter((item) => (Number(item.kg) || Number(item.units)) > 0);
    const ordersByCrop = activeHarvestList.length ? groupHarvestList(activeHarvestList) : groupCultivatedOrders(today);

    ordersByCrop.forEach((group, cropId) => {
      const crop = findCrop(cropId);
      items.push({
        id: `harvest:${cropId}`,
        action: "harvest",
        skill: "recoleccion",
        title: `Recolectar ${formatNumber(group.kg)} kg de ${crop?.name || "cultivo"}`,
        detail: group.source === "sheet"
          ? `Lista recolecta AppSheet${group.units ? ` - ${formatNumber(group.units)} ud` : ""}`
          : `Clientes: ${group.clients.join(", ")}`,
        minutes: estimateHarvestMinutes(group.kg, crop),
        priority: 120 + group.priority * 10,
        cropId,
        kg: group.kg
      });
    });

    state.crops.forEach((crop) => {
      if (crop.source === "purchased") return;
      const waterGap = daysBetween(crop.lastWatered, today);
      if (waterGap >= crop.waterEveryDays) {
        const rainPenalty = weather.status === "ready" && weather.rainProbability >= 70 ? -25 : 0;
        const heatBoost = weather.status === "ready" && weather.tempMax >= 30 ? 20 : 0;
        items.push({
          id: `water:${crop.id}`,
          action: "water",
          skill: "riego",
          title: `Regar ${crop.name}`,
          detail: `${crop.plot} · ${waterGap} dias desde el ultimo riego`,
          minutes: estimateWaterMinutes(crop),
          priority: 90 + waterGap * 4 + rainPenalty + heatBoost,
          cropId: crop.id
        });
      }

      const weedGap = daysBetween(crop.lastWeeded, today);
      if (weedGap >= crop.weedEveryDays) {
        items.push({
          id: `weed:${crop.id}`,
          action: "weed",
          skill: "hierbas",
          title: `Quitar hierbas en ${crop.name}`,
          detail: `${crop.plot} · ${weedGap} dias desde la ultima limpieza`,
          minutes: estimateWeedMinutes(crop),
          priority: 55 + weedGap,
          cropId: crop.id
        });
      }
    });

    groupPurchaseNeeds(today).forEach((group, cropId) => {
      const crop = findCrop(cropId);
      items.push({
        id: `purchase:${cropId}`,
        action: "purchase",
        skill: "general",
        title: `Comprar ${formatNumber(group.kg)} kg de ${crop?.name || "producto"}`,
        detail: `Necesario para ${formatDate(group.firstDue)} - ${group.clients.join(", ")}`,
        minutes: Math.max(20, Math.ceil(group.kg * 4)),
        priority: group.firstDue <= today ? 118 : 78,
        cropId,
        kg: group.kg
      });
    });

    groupDeliveryNeeds(today).forEach((group) => {
      items.push({
        id: `delivery:${group.key}`,
        action: "delivery",
        skill: group.method === "own" ? "arreglos" : "general",
        title: group.method === "agency" ? "Preparar envios por agencia" : `Reparto ${routeLabel(group.route)}`,
        detail: `${group.orders.length} pedidos - ${deliveryRuleLabel(group.method, group.route)}`,
        minutes: group.method === "agency" ? 45 + group.orders.length * 8 : 90 + group.orders.length * 18,
        priority: group.method === "agency" ? 112 : 108,
        deliveryMethod: group.method,
        route: group.route
      });
    });

    state.products
      .filter((product) => product.active && daysBetween(product.lastApplied, today) >= product.frequencyDays)
      .forEach((product) => {
        const crop = findCrop(product.cropId);
        const rainPenalty = weather.status === "ready" && weather.rainProbability >= 55 ? -20 : 0;
        items.push({
          id: `product:${product.id}`,
          action: "product",
          skill: "tratamientos",
          title: `Aplicar ${product.name}`,
          detail: `${crop?.name || "Cultivo"} · dosis ${product.dose}`,
          minutes: estimateLearned("tratamientos", 35),
          priority: 75 + rainPenalty,
          productId: product.id,
          cropId: product.cropId
        });
      });

    state.tasks
      .filter((task) => task.status !== "done")
      .filter((task) => task.dueDate <= today || task.type === "repair" || Number(task.priority) >= 3)
      .forEach((task) => {
        const urgency = task.dueDate <= today ? 35 : Math.max(0, 12 - daysBetween(today, task.dueDate));
        items.push({
          id: `task:${task.id}`,
          action: task.type === "repair" ? "repair" : "manual",
          skill: taskSkill(task.type),
          title: task.title,
          detail: `${taskTypeLabel(task.type)} · limite ${formatDate(task.dueDate)}`,
          minutes: Number(task.estimateMinutes) || 30,
          priority: 25 + Number(task.priority) * 12 + urgency,
          taskId: task.id
        });
      });

    items.sort((a, b) => b.priority - a.priority || b.minutes - a.minutes);
    const { lanes, overflow } = scheduleItems(items);
    return { items, lanes, overflow };
  }

  function groupHarvestList(items) {
    return items.reduce((map, item) => {
      const crop = item.cropId ? findCrop(item.cropId) : findCropByName(item.productName);
      const cropId = crop?.id || item.cropId || item.externalId || item.id;
      const current = map.get(cropId) || { kg: 0, units: 0, clients: [], priority: 3, source: "sheet" };
      current.kg += Number(item.kg) || 0;
      current.units += Number(item.units) || 0;
      map.set(cropId, current);
      return map;
    }, new Map());
  }

  function groupCultivatedOrders(today) {
    return state.orders
      .filter((order) => order.status !== "done" && order.dueDate <= today)
      .filter((order) => findCrop(order.cropId)?.source !== "purchased")
      .reduce((map, order) => {
        const current = map.get(order.cropId) || { kg: 0, clients: [], priority: 1, source: "orders" };
        current.kg += Number(order.kg) || 0;
        current.clients.push(order.client);
        current.priority = Math.max(current.priority, Number(order.priority) || 1);
        map.set(order.cropId, current);
        return map;
      }, new Map());
  }

  function groupPurchaseNeeds(today) {
    return state.orders
      .filter((order) => order.status !== "done")
      .filter((order) => {
        const crop = findCrop(order.cropId);
        if (crop?.source !== "purchased") return false;
        const lead = Number(crop.purchaseLeadDays) || 3;
        return daysBetween(today, order.dueDate) <= lead && order.dueDate >= today;
      })
      .reduce((map, order) => {
        const current = map.get(order.cropId) || { kg: 0, clients: [], firstDue: order.dueDate };
        current.kg += Number(order.kg) || 0;
        current.clients.push(order.client);
        if (order.dueDate < current.firstDue) current.firstDue = order.dueDate;
        map.set(order.cropId, current);
        return map;
      }, new Map());
  }

  function groupDeliveryNeeds(today) {
    const groups = new Map();
    state.orders
      .filter((order) => order.status !== "done" && order.dueDate === today)
      .forEach((order) => {
        const rule = inferDeliveryRule(order, today);
        const key = `${rule.method}:${rule.route}`;
        const current = groups.get(key) || { key, method: rule.method, route: rule.route, orders: [] };
        current.orders.push(order);
        groups.set(key, current);
      });
    return [...groups.values()];
  }

  function inferDeliveryRule(order, isoDate) {
    if (order.deliveryMethod && order.deliveryMethod !== "auto") {
      return { method: order.deliveryMethod, route: order.zone || "other" };
    }
    const day = parseISO(isoDate).getDay();
    if (day === 2 && ["alicante-shops", "alicante"].includes(order.zone)) return { method: "own", route: "alicante-shops" };
    if (day === 4) return { method: "own", route: "murcia-cartagena" };
    if (day === 5) return { method: "own", route: "murcia-alicante" };
    if ([1, 2, 3].includes(day)) return { method: "agency", route: "agency" };
    return { method: "own", route: order.zone || "other" };
  }

  function routeLabel(route) {
    const labels = {
      agency: "agencia",
      "alicante-shops": "tiendas Alicante",
      alicante: "Alicante",
      murcia: "Murcia",
      cartagena: "Cartagena",
      "murcia-cartagena": "Murcia / Cartagena",
      "murcia-alicante": "Murcia / Alicante",
      other: "otra zona"
    };
    return labels[route] || route;
  }

  function deliveryRuleLabel(method, route) {
    if (method === "agency") return "Lunes a miercoles: salida con agencia";
    if (route === "alicante-shops") return "Martes: dos tiendas de Alicante";
    if (route === "murcia-cartagena") return "Jueves: Murcia y Cartagena";
    if (route === "murcia-alicante") return "Viernes: Murcia y Alicante";
    return "Ruta propia";
  }

  function scheduleItems(items) {
    const start = minutesFromTime(state.settings.workStart);
    const restEvery = Number(state.settings.restEveryMinutes) || 180;
    const breakMinutes = Number(state.settings.breakMinutes) || 20;
    const lanes = state.people
      .filter((person) => person.active)
      .map((person) => ({
        person,
        cursor: start,
        remaining: Number(person.minutes) || 0,
        workedSinceBreak: 0,
        used: 0,
        blocks: []
      }));
    const overflow = [];

    items.forEach((item) => {
      const candidates = lanes
        .filter((lane) => lane.remaining > 0)
        .sort((a, b) => scorePerson(b.person, item.skill) - scorePerson(a.person, item.skill) || b.remaining - a.remaining);
      const lane = candidates.find((candidate) => candidate.remaining >= item.minutes) || candidates[0];
      if (!lane) {
        overflow.push({ ...item, remaining: item.minutes });
        return;
      }

      if (lane.workedSinceBreak >= restEvery && breakMinutes > 0) {
        const restStart = lane.cursor;
        lane.cursor += breakMinutes;
        lane.workedSinceBreak = 0;
        lane.blocks.push({
          type: "break",
          start: timeFromMinutes(restStart),
          end: timeFromMinutes(lane.cursor)
        });
      }

      const assigned = Math.min(item.minutes, lane.remaining);
      const blockStart = lane.cursor;
      lane.cursor += assigned;
      lane.remaining -= assigned;
      lane.used += assigned;
      lane.workedSinceBreak += assigned;
      lane.blocks.push({
        type: "task",
        item: { ...item, minutes: assigned },
        start: timeFromMinutes(blockStart),
        end: timeFromMinutes(lane.cursor)
      });

      if (assigned < item.minutes) {
        overflow.push({ ...item, remaining: item.minutes - assigned });
      }
    });

    return { lanes, overflow };
  }

  function scorePerson(person, skill) {
    if (!skill || skill === "general") return 1;
    return person.skills.includes(skill) ? 4 : person.skills.includes("general") ? 2 : 0;
  }

  function estimateHarvestMinutes(kg, crop) {
    const defaultMinutes = Math.ceil((Number(kg) / (Number(crop?.yieldKgHour) || 12)) * 60);
    return Math.max(15, estimateLearned("recoleccion", defaultMinutes));
  }

  function estimateWaterMinutes(crop) {
    const base = Math.ceil(18 + (Number(crop.plants) || 0) * 0.18);
    return Math.max(15, estimateLearned("riego", base));
  }

  function estimateWeedMinutes(crop) {
    const base = Math.ceil(22 + (Number(crop.plants) || 0) * 0.22);
    return Math.max(20, estimateLearned("hierbas", base));
  }

  function estimateLearned(skill, fallback) {
    const learned = state.learning?.[skill];
    if (!learned || !learned.count) return fallback;
    return Math.round((fallback + learned.avg) / 2);
  }

  function updateLearning(skill, minutes) {
    if (!skill || !minutes) return;
    const current = state.learning[skill] || { count: 0, avg: minutes };
    const count = current.count + 1;
    const avg = Math.round((current.avg * current.count + minutes) / count);
    state.learning[skill] = { count, avg };
  }

  function handleCropSubmit(event) {
    event.preventDefault();
    const id = byId("cropEditId").value || uid("crop");
    const crop = {
      id,
      name: byId("cropName").value.trim(),
      plot: byId("cropPlot").value.trim(),
      source: byId("cropSource").value,
      plants: Number(byId("cropPlants").value) || 1,
      stage: byId("cropStage").value,
      waterEveryDays: Number(byId("cropWaterEvery").value) || 2,
      weedEveryDays: Number(byId("cropWeedEvery").value) || 10,
      lastWatered: byId("cropLastWatered").value || todayISO(),
      lastWeeded: byId("cropLastWeeded").value || todayISO(),
      yieldKgHour: Number(byId("cropYieldHour").value) || 12,
      purchaseLeadDays: Number(byId("cropPurchaseLead").value) || 3,
      available: true,
      externalId: state.crops.find((item) => item.id === id)?.externalId || ""
    };
    upsert(state.crops, crop);
    resetCropForm();
    saveState();
    toast("Cultivo guardado");
  }

  function handleFieldSectionSubmit(event) {
    event.preventDefault();
    const id = byId("fieldSectionEditId").value || uid("section");
    const existing = state.fieldSections.find((section) => section.id === id);
    const section = {
      id,
      name: byId("fieldSectionName").value.trim(),
      notes: byId("fieldSectionNotes").value.trim(),
      rivers: existing?.rivers || []
    };
    upsert(state.fieldSections, section);
    resetFieldSectionForm();
    saveState();
    toast("Seccion guardada");
  }

  function handleFieldRiverSubmit(event) {
    event.preventDefault();
    const sectionId = byId("fieldRiverSection").value;
    const section = state.fieldSections.find((item) => item.id === sectionId);
    if (!section) {
      toast("Crea una seccion antes");
      return;
    }
    const id = byId("fieldRiverEditId").value || uid("river");
    const river = {
      id,
      name: byId("fieldRiverName").value.trim(),
      capacityPlants: Number(byId("fieldRiverCapacity").value) || 1,
      cropId: byId("fieldRiverCrop").value,
      plantedPlants: Number(byId("fieldRiverPlants").value) || 0,
      plantedAt: byId("fieldRiverPlantedAt").value || todayISO(),
      notes: byId("fieldRiverNotes").value.trim()
    };
    state.fieldSections.forEach((item) => {
      if (item.id !== sectionId) item.rivers = item.rivers.filter((current) => current.id !== id);
    });
    upsert(section.rivers, river);
    syncCropPlantsFromFieldPlan();
    resetFieldRiverForm();
    saveState();
    toast("Rio guardado");
  }

  function handleOrderSubmit(event) {
    event.preventDefault();
    const id = byId("orderEditId").value || uid("order");
    const order = {
      id,
      client: byId("orderClient").value.trim(),
      cropId: byId("orderCrop").value,
      kg: Number(byId("orderKg").value) || 0,
      dueDate: byId("orderDue").value || todayISO(),
      priority: Number(byId("orderPriority").value) || 2,
      status: state.orders.find((item) => item.id === id)?.status || "pending",
      zone: byId("orderZone").value,
      deliveryMethod: byId("orderDelivery").value,
      externalId: state.orders.find((item) => item.id === id)?.externalId || ""
    };
    upsert(state.orders, order);
    resetOrderForm();
    saveState();
    toast("Pedido guardado");
  }

  function handlePersonSubmit(event) {
    event.preventDefault();
    const id = byId("personEditId").value || uid("person");
    const skills = all("#personForm input[type='checkbox']:checked").map((input) => input.value);
    const person = {
      id,
      name: byId("personName").value.trim(),
      minutes: Number(byId("personMinutes").value) || 360,
      skills: skills.length ? skills : ["general"],
      active: state.people.find((item) => item.id === id)?.active !== false
    };
    upsert(state.people, person);
    resetPersonForm();
    saveState();
    toast("Persona guardada");
  }

  function handleTaskSubmit(event) {
    event.preventDefault();
    const id = byId("taskEditId").value || uid("task");
    const task = {
      id,
      title: byId("taskTitle").value.trim(),
      type: byId("taskType").value,
      dueDate: byId("taskDue").value || todayISO(),
      estimateMinutes: Number(byId("taskMinutes").value) || 30,
      priority: Number(byId("taskPriority").value) || 2,
      notes: byId("taskNotes").value.trim(),
      status: state.tasks.find((item) => item.id === id)?.status || "todo"
    };
    upsert(state.tasks, task);
    resetTaskForm();
    saveState();
    toast("Tarea guardada");
  }

  function handleProductSubmit(event) {
    event.preventDefault();
    const id = byId("productEditId").value || uid("product");
    const product = {
      id,
      name: byId("productName").value.trim(),
      cropId: byId("productCrop").value,
      dose: byId("productDose").value.trim(),
      frequencyDays: Number(byId("productFrequency").value) || 14,
      lastApplied: byId("productLast").value || todayISO(),
      notes: byId("productNotes").value.trim(),
      active: true
    };
    upsert(state.products, product);
    resetProductForm();
    saveState();
    toast("Producto guardado");
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    state.settings.farmName = byId("settingFarmName").value.trim() || "Mi finca";
    state.settings.lat = byId("settingLat").value.trim();
    state.settings.lon = byId("settingLon").value.trim();
    state.settings.workStart = byId("settingStart").value || "07:00";
    state.settings.workEnd = byId("settingEnd").value || "16:00";
    state.settings.restEveryMinutes = Number(byId("settingRestEvery").value) || 180;
    state.settings.breakMinutes = Number(byId("settingBreak").value) || 20;
    state.settings.notifyHour = byId("settingNotifyHour").value || "06:45";
    state.settings.appsScriptUrl = byId("settingSheetUrl").value.trim();
    state.settings.appsScriptToken = byId("settingSheetToken").value.trim();
    state.settings.sheetProductsTab = byId("settingProductsTab").value.trim() || "PRODUCTOS";
    state.settings.sheetOrdersTab = byId("settingOrdersTab").value.trim() || "VENTA";
    state.settings.sheetSaleLinesTab = byId("settingSaleLinesTab").value.trim() || "VENTAS";
    state.settings.sheetClientsTab = byId("settingClientsTab").value.trim() || "CLIENTES";
    state.settings.sheetHarvestTab = byId("settingHarvestTab").value.trim() || "LISTA RECOLECTA";
    saveCloudConfig({
      supabaseUrl: byId("settingSupabaseUrl").value.trim(),
      supabaseAnonKey: byId("settingSupabaseKey").value.trim()
    });
    saveState();
    initCloud();
    loadWeather();
    if (state.settings.appsScriptUrl) syncAppSheetNow(true);
    toast("Ajustes guardados");
  }

  function handleChatSubmit(event) {
    event.preventDefault();
    const input = byId("chatInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    try {
      runAssistant(text);
    } catch (error) {
      const last = state.chat[state.chat.length - 1];
      if (!last || last.role !== "user" || last.text !== text) {
        state.chat.push({ role: "user", text, at: new Date().toISOString() });
      }
      state.chat.push({
        role: "assistant",
        text: `No he podido responder por un error interno: ${error.message}. Ya puedes seguir escribiendo y no me quedare callado.`,
        at: new Date().toISOString()
      });
      saveState();
      showView("assistant");
    }
  }

  function runAssistant(text) {
    state.chat.push({ role: "user", text, at: new Date().toISOString() });
    renderChat();
    let answer;
    try {
      answer = assistantReply(text);
    } catch (error) {
      answer = `No he podido calcular la respuesta: ${error.message}. Prueba otra pregunta o revisa los datos de cultivos/pedidos.`;
    }
    state.chat.push({ role: "assistant", text: answer, at: new Date().toISOString() });
    saveState();
    showView("assistant");
  }

  function assistantReply(text) {
    const plan = buildDailyPlan();
    const query = normalizeText(text);
    if (query.includes("recolect") || query.includes("pedido")) {
      return harvestSummary();
    }
    if (query.includes("compr") || query.includes("comprado")) {
      return purchaseSummary(plan);
    }
    if (query.includes("plano") || query.includes("parcela") || query.includes("seccion") || query.includes("rio") || query.includes("plant")) {
      return fieldPlanSummary();
    }
    if (query.includes("riego") || query.includes("regar")) {
      return waterSummary(plan);
    }
    if (query.includes("producto") || query.includes("tratamiento") || query.includes("ecologico")) {
      return productSummary(plan);
    }
    if (query.includes("hierba") || query.includes("limpiar")) {
      return weedSummary(plan);
    }
    if (query.includes("arreglo") || query.includes("finca") || query.includes("repar")) {
      return repairSummary(plan);
    }
    if (query.includes("foto") || query.includes("bicho") || query.includes("plaga")) {
      return "Sube la foto en la pestaña Foto, elige el sintoma aproximado y guardare la observacion. Si la severidad es media o alta, creare una tarea para tratar o revisar.";
    }
    if (query.includes("memoria") || query.includes("aprend")) {
      return memorySummary();
    }
    return formatPlanSummary(plan);
  }

  function harvestSummary() {
    const harvest = buildDailyPlan().items.filter((item) => item.action === "harvest");
    if (!harvest.length) return "Hoy no hay lista de recoleccion pendiente.";
    return harvest.map((item) => `${item.title}: ${item.detail}.`).join("\n");
  }

  function purchaseSummary(plan) {
    const purchases = plan.items.filter((item) => item.action === "purchase");
    if (!purchases.length) return "No hay compras previstas dentro del margen de aviso de cada producto.";
    return purchases.map((item) => `- ${item.title}: ${item.detail}`).join("\n");
  }

  function waterSummary(plan) {
    const waters = plan.items.filter((item) => item.action === "water");
    if (!waters.length) return "No hay riegos vencidos ahora mismo.";
    const weatherLine = weather.status === "ready" && weather.rainProbability >= 70
      ? "Hay alta probabilidad de lluvia: revisa humedad antes de abrir riego."
      : "Riego recomendado segun fechas guardadas.";
    return `${weatherLine}\n${waters.map((item) => `- ${item.title}: ${item.detail}`).join("\n")}`;
  }

  function productSummary(plan) {
    const products = plan.items.filter((item) => item.action === "product");
    if (!products.length) return "No toca producto ecologico segun las frecuencias guardadas.";
    const weatherLine = weather.status === "ready" && weather.rainProbability >= 55
      ? "Evita aplicaciones foliares si llueve o hay viento fuerte."
      : "Buen momento si lo haces fuera de horas de calor.";
    return `${weatherLine}\n${products.map((item) => `- ${item.title}: ${item.detail}`).join("\n")}`;
  }

  function weedSummary(plan) {
    const weeds = plan.items.filter((item) => item.action === "weed");
    if (!weeds.length) return "No hay limpiezas de hierbas vencidas.";
    return weeds.map((item) => `- ${item.title}: ${item.detail}`).join("\n");
  }

  function repairSummary(plan) {
    const repairs = plan.items.filter((item) => item.action === "repair");
    if (!repairs.length) return "No hay arreglos urgentes. Si sobra tiempo tras pedidos, riego y tratamientos, mete arreglos de baja prioridad.";
    return `Los arreglos se colocan despues de pedidos y riego:\n${repairs.map((item) => `- ${item.title}: ${item.minutes} min`).join("\n")}`;
  }

  function memorySummary() {
    const learned = Object.entries(state.learning || {})
      .map(([skill, data]) => `${skillLabel(skill)}: media ${data.avg} min (${data.count} registros)`)
      .join("\n");
    const observations = state.observations.slice(-3).map((item) => {
      const crop = findCrop(item.cropId);
      return `${formatDate(item.date)} · ${crop?.name || "Cultivo"} · ${symptomLabel(item.symptom)}`;
    }).join("\n");
    return `Memoria activa:\n${learned || "Aun no hay tiempos reales aprendidos."}\n${observations ? `\nUltimas observaciones:\n${observations}` : ""}`;
  }

  function fieldPlanSummary() {
    if (!state.fieldSections.length) return "Todavia no hay secciones en el plano. Crea una seccion y despues anade rios con cultivo y plantas.";
    return state.fieldSections.map((section) => {
      const lines = section.rivers.map((river) => {
        const crop = findCrop(river.cropId);
        return `${river.name}: ${crop?.name || "sin cultivo"} (${river.plantedPlants}/${river.capacityPlants} plantas, plantado ${formatDate(river.plantedAt)})`;
      });
      return `${section.name}\n${lines.length ? lines.join("\n") : "Sin rios."}`;
    }).join("\n\n");
  }

  function formatPlanSummary(plan = buildDailyPlan()) {
    if (!plan.items.length) return "Hoy no hay tareas calculadas. Revisa pedidos, cultivos y productos.";
    const lines = plan.items.slice(0, 12).map((item, index) => `${index + 1}. ${item.title} (${item.minutes} min)`);
    const overflow = plan.overflow.reduce((sum, item) => sum + item.remaining, 0);
    if (overflow > 0) lines.push(`Faltan ${overflow} min por colocar.`);
    return lines.join("\n");
  }

  function handlePhotoSubmit(event) {
    event.preventDefault();
    const cropId = byId("photoCrop").value;
    const symptom = byId("photoSymptom").value;
    const severity = Number(byId("photoSeverity").value) || 2;
    const notes = byId("photoNotes").value.trim();
    const recommendation = diagnose(symptom, severity);
    const observation = {
      id: uid("obs"),
      cropId,
      symptom,
      severity,
      notes,
      recommendation,
      date: todayISO()
    };
    state.observations.push(observation);

    if (severity >= 2) {
      const crop = findCrop(cropId);
      state.tasks.push({
        id: uid("task"),
        title: `Revisar ${symptomLabel(symptom)} en ${crop?.name || "cultivo"}`,
        type: "general",
        dueDate: severity >= 3 ? todayISO() : addDays(todayISO(), 1),
        estimateMinutes: severity >= 3 ? 50 : 30,
        priority: severity >= 3 ? 3 : 2,
        notes: recommendation.slice(0, 160),
        status: "todo"
      });
    }

    byId("photoResult").innerHTML = `<strong>${escapeHtml(symptomLabel(symptom))}</strong><p>${escapeHtml(recommendation)}</p>`;
    byId("photoNotes").value = "";
    byId("photoInput").value = "";
    byId("photoPreview").removeAttribute("src");
    saveState();
    toast("Observacion guardada");
  }

  function diagnose(symptom, severity) {
    const urgent = severity >= 3 ? "Actua hoy y revisa de nuevo mañana. " : "";
    const guides = {
      aphids: "Busca colonias en brotes tiernos y presencia de hormigas. Conserva mariquitas y crisopas; si sube la presion, aplica jabon potasico al atardecer y repite a los 5-7 dias.",
      thrips: "Coloca placas azules, retira flores muy afectadas y favorece Orius si aparece. En ecologico suele ayudar jabon potasico o neem, evitando horas de calor.",
      whitefly: "Usa placas amarillas, revisa el envés de hojas y mejora ventilacion. Jabon potasico o neem puede bajar poblacion; protege parasitoides como Encarsia.",
      caterpillar: "Retira orugas visibles y huevos. Bacillus thuringiensis funciona mejor sobre larvas pequeñas y al atardecer.",
      mites: "Aumenta humedad ambiental si el cultivo lo permite, retira hojas muy afectadas y evita exceso de nitrogeno. Favorece acaros depredadores; jabon potasico ayuda en focos iniciales.",
      snails: "Retirada manual al amanecer, refugios trampa y limpieza de bordes. Si hace falta, usa fosfato ferrico autorizado en ecologico.",
      fungus: "Quita hojas enfermas, evita mojar follaje, mejora ventilacion y riega temprano. Valora cobre o azufre solo si esta permitido para ese cultivo y dosis.",
      beneficial: "No trates esa zona de entrada. Fotografia y observa: mariquitas, crisopas, sirfidos, parasitoides y aranas ayudan a controlar plagas.",
      unknown: "Aisla la zona en observacion, mira envés de hojas con lupa y registra si hay melaza, mordidas, telaraña o manchas. Empieza con retirada manual y jabon potasico suave si ves insecto blando."
    };
    const weatherLine = weather.status === "ready" && (weather.rainProbability > 55 || weather.windMax > 30)
      ? "Por clima, evita pulverizar hasta que baje lluvia o viento. "
      : "";
    return `${urgent}${weatherLine}${guides[symptom] || guides.unknown}`;
  }

  function previewPhoto() {
    const file = byId("photoInput").files?.[0];
    const preview = byId("photoPreview");
    if (!file) {
      preview.removeAttribute("src");
      return;
    }
    preview.src = URL.createObjectURL(file);
  }

  function handleActionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id, section } = button.dataset;
    const handlers = {
      "complete-plan": () => completePlanItem(id),
      "mark-water": () => markWater(id),
      "mark-weed": () => markWeed(id),
      "mark-product": () => markProduct(id),
      "done-order": () => doneOrder(id),
      "done-task": () => doneTask(id),
      "toggle-person": () => togglePerson(id),
      "edit-crop": () => editCrop(id),
      "edit-section": () => editFieldSection(id),
      "edit-river": () => editFieldRiver(section, id),
      "edit-order": () => editOrder(id),
      "edit-person": () => editPerson(id),
      "edit-task": () => editTask(id),
      "edit-product": () => editProduct(id),
      "delete-crop": () => deleteItem("crops", id, "Cultivo eliminado"),
      "delete-section": () => deleteFieldSection(id),
      "clear-river": () => clearFieldRiver(section, id),
      "delete-order": () => deleteItem("orders", id, "Pedido eliminado"),
      "delete-person": () => deleteItem("people", id, "Persona eliminada"),
      "delete-task": () => deleteItem("tasks", id, "Tarea eliminada"),
      "delete-product": () => deleteItem("products", id, "Producto eliminado"),
      "delete-observation": () => deleteItem("observations", id, "Observacion eliminada")
    };
    handlers[action]?.();
  }

  function completePlanItem(id) {
    const [kind, entityId] = id.split(":");
    if (kind === "harvest") {
      state.orders
        .filter((order) => order.cropId === entityId && order.status !== "done" && order.dueDate <= todayISO())
        .forEach((order) => { order.status = "done"; });
      updateLearning("recoleccion", askActualMinutes("recoleccion"));
      toast("Recoleccion marcada");
    }
    if (kind === "water") markWater(entityId, false);
    if (kind === "weed") markWeed(entityId, false);
    if (kind === "product") markProduct(entityId, false);
    if (kind === "task") doneTask(entityId, false);
    if (kind === "purchase") toast("Compra marcada en el plan");
    if (kind === "delivery") toast("Reparto marcado en el plan");
    saveState();
  }

  function askActualMinutes(skill) {
    const learned = state.learning?.[skill]?.avg;
    const raw = window.prompt("Minutos reales usados", learned || "");
    const minutes = Number(raw);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  function markWater(id, shouldSave = true) {
    const crop = findCrop(id);
    if (!crop) return;
    crop.lastWatered = todayISO();
    updateLearning("riego", askActualMinutes("riego"));
    if (shouldSave) saveState();
    toast("Riego marcado");
  }

  function markWeed(id, shouldSave = true) {
    const crop = findCrop(id);
    if (!crop) return;
    crop.lastWeeded = todayISO();
    updateLearning("hierbas", askActualMinutes("hierbas"));
    if (shouldSave) saveState();
    toast("Hierbas marcadas");
  }

  function markProduct(id, shouldSave = true) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    product.lastApplied = todayISO();
    updateLearning("tratamientos", askActualMinutes("tratamientos"));
    if (shouldSave) saveState();
    toast("Producto marcado");
  }

  function doneOrder(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    order.status = order.status === "done" ? "pending" : "done";
    saveState();
  }

  function doneTask(id, shouldSave = true) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    task.status = task.status === "done" ? "todo" : "done";
    if (task.status === "done") updateLearning(taskSkill(task.type), askActualMinutes(taskSkill(task.type)));
    if (shouldSave) saveState();
  }

  function togglePerson(id) {
    const person = state.people.find((item) => item.id === id);
    if (!person) return;
    person.active = !person.active;
    saveState();
  }

  function deleteItem(collection, id, message) {
    if (!window.confirm("Eliminar este elemento?")) return;
    state[collection] = state[collection].filter((item) => item.id !== id);
    saveState();
    toast(message);
  }

  function editCrop(id) {
    const crop = findCrop(id);
    if (!crop) return;
    byId("cropEditId").value = crop.id;
    byId("cropName").value = crop.name;
    byId("cropPlot").value = crop.plot;
    byId("cropSource").value = crop.source;
    byId("cropPlants").value = crop.plants;
    byId("cropStage").value = crop.stage;
    byId("cropWaterEvery").value = crop.waterEveryDays;
    byId("cropWeedEvery").value = crop.weedEveryDays;
    byId("cropLastWatered").value = crop.lastWatered;
    byId("cropLastWeeded").value = crop.lastWeeded;
    byId("cropYieldHour").value = crop.yieldKgHour;
    byId("cropPurchaseLead").value = crop.purchaseLeadDays;
    showView("crops");
  }

  function editFieldSection(id) {
    const section = state.fieldSections.find((item) => item.id === id);
    if (!section) return;
    byId("fieldSectionEditId").value = section.id;
    byId("fieldSectionName").value = section.name;
    byId("fieldSectionNotes").value = section.notes;
    showView("crops");
  }

  function editFieldRiver(sectionId, riverId) {
    const section = state.fieldSections.find((item) => item.id === sectionId);
    const river = section?.rivers.find((item) => item.id === riverId);
    if (!section || !river) return;
    byId("fieldRiverEditId").value = river.id;
    byId("fieldRiverSection").value = section.id;
    byId("fieldRiverName").value = river.name;
    byId("fieldRiverCapacity").value = river.capacityPlants;
    byId("fieldRiverCrop").value = river.cropId;
    byId("fieldRiverPlants").value = river.plantedPlants;
    byId("fieldRiverPlantedAt").value = river.plantedAt;
    byId("fieldRiverNotes").value = river.notes;
    showView("crops");
  }

  function deleteFieldSection(id) {
    if (!window.confirm("Eliminar esta seccion y sus rios?")) return;
    state.fieldSections = state.fieldSections.filter((section) => section.id !== id);
    syncCropPlantsFromFieldPlan();
    saveState();
    toast("Seccion eliminada");
  }

  function clearFieldRiver(sectionId, riverId) {
    const section = state.fieldSections.find((item) => item.id === sectionId);
    const river = section?.rivers.find((item) => item.id === riverId);
    if (!river) return;
    river.cropId = "";
    river.plantedPlants = 0;
    river.plantedAt = todayISO();
    syncCropPlantsFromFieldPlan();
    saveState();
    toast("Rio vaciado");
  }

  function editOrder(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    byId("orderEditId").value = order.id;
    byId("orderClient").value = order.client;
    byId("orderCrop").value = order.cropId;
    byId("orderKg").value = order.kg;
    byId("orderDue").value = order.dueDate;
    byId("orderPriority").value = order.priority;
    byId("orderZone").value = order.zone || "other";
    byId("orderDelivery").value = order.deliveryMethod || "auto";
    showView("orders");
  }

  function editPerson(id) {
    const person = state.people.find((item) => item.id === id);
    if (!person) return;
    byId("personEditId").value = person.id;
    byId("personName").value = person.name;
    byId("personMinutes").value = person.minutes;
    all("#personForm input[type='checkbox']").forEach((input) => {
      input.checked = person.skills.includes(input.value);
    });
    showView("team");
  }

  function editTask(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    byId("taskEditId").value = task.id;
    byId("taskTitle").value = task.title;
    byId("taskType").value = task.type;
    byId("taskDue").value = task.dueDate;
    byId("taskMinutes").value = task.estimateMinutes;
    byId("taskPriority").value = task.priority;
    byId("taskNotes").value = task.notes;
    showView("tasks");
  }

  function editProduct(id) {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    byId("productEditId").value = product.id;
    byId("productName").value = product.name;
    byId("productCrop").value = product.cropId;
    byId("productDose").value = product.dose;
    byId("productFrequency").value = product.frequencyDays;
    byId("productLast").value = product.lastApplied;
    byId("productNotes").value = product.notes;
    showView("products");
  }

  function resetCropForm() {
    byId("cropForm").reset();
    byId("cropEditId").value = "";
    byId("cropPlants").value = 50;
    byId("cropWaterEvery").value = 2;
    byId("cropWeedEvery").value = 10;
    byId("cropYieldHour").value = 12;
    byId("cropSource").value = "cultivated";
    byId("cropPurchaseLead").value = 3;
    byId("cropLastWatered").value = todayISO();
    byId("cropLastWeeded").value = todayISO();
  }

  function resetFieldSectionForm() {
    byId("fieldSectionForm").reset();
    byId("fieldSectionEditId").value = "";
  }

  function resetFieldRiverForm() {
    byId("fieldRiverForm").reset();
    byId("fieldRiverEditId").value = "";
    byId("fieldRiverCapacity").value = 50;
    byId("fieldRiverPlants").value = 0;
    byId("fieldRiverPlantedAt").value = todayISO();
    renderFieldOptions();
  }

  function resetOrderForm() {
    byId("orderForm").reset();
    byId("orderEditId").value = "";
    byId("orderDue").value = todayISO();
    byId("orderDelivery").value = "auto";
  }

  function resetPersonForm() {
    byId("personForm").reset();
    byId("personEditId").value = "";
    byId("personMinutes").value = 420;
    all("#personForm input[type='checkbox']").forEach((input) => {
      input.checked = input.value !== "arreglos";
    });
  }

  function resetTaskForm() {
    byId("taskForm").reset();
    byId("taskEditId").value = "";
    byId("taskDue").value = todayISO();
  }

  function resetProductForm() {
    byId("productForm").reset();
    byId("productEditId").value = "";
    byId("productLast").value = todayISO();
  }

  async function loadWeather() {
    const { lat, lon } = state.settings;
    if (!lat || !lon) {
      weather = { status: "missing" };
      renderWeather();
      return;
    }
    weather = { status: "loading" };
    renderWeather();
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lon,
      daily: "temperature_2m_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
      timezone: "auto",
      forecast_days: "1"
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
      if (!response.ok) throw new Error("No se pudo leer Open-Meteo");
      const data = await response.json();
      weather = {
        status: "ready",
        tempMax: Number(data.daily?.temperature_2m_max?.[0] || 0),
        rainProbability: Number(data.daily?.precipitation_probability_max?.[0] || 0),
        rainSum: Number(data.daily?.precipitation_sum?.[0] || 0),
        windMax: Number(data.daily?.wind_speed_10m_max?.[0] || 0),
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      weather = { status: "error", message: error.message };
    }
    render();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      toast("Este navegador no soporta notificaciones");
      return;
    }
    const permission = await Notification.requestPermission();
    state.settings.notificationsEnabled = permission === "granted";
    saveState();
    if (permission === "granted") {
      showDailyNotification(true);
      toast("Notificaciones activadas");
    }
  }

  function scheduleDailyNotification() {
    clearTimeout(notificationTimer);
    if (!state.settings.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
    const [hour, minute] = (state.settings.notifyHour || "06:45").split(":").map(Number);
    const now = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = Math.min(next - now, 2147483647);
    notificationTimer = setTimeout(() => {
      showDailyNotification();
      scheduleDailyNotification();
    }, delay);
  }

  async function showDailyNotification(force = false) {
    if (!("Notification" in window)) return;
    if (!force && (!state.settings.notificationsEnabled || Notification.permission !== "granted")) return;
    const body = formatPlanSummary(buildDailyPlan()).split("\n").slice(0, 3).join(" · ");
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification("FincaBot: plan de hoy", {
        body,
        icon: "icon.svg",
        badge: "icon.svg"
      });
      return;
    }
    new Notification("FincaBot: plan de hoy", { body, icon: "icon.svg" });
  }

  function copyPlanSummary() {
    const text = formatPlanSummary(buildDailyPlan());
    navigator.clipboard?.writeText(text).then(() => toast("Resumen copiado")).catch(() => {
      window.prompt("Resumen del dia", text);
    });
  }

  function exportMemory() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fincabot-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importMemory(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = ensureState(JSON.parse(reader.result));
        saveState();
        toast("Memoria importada");
      } catch {
        toast("Archivo no valido");
      }
    };
    reader.readAsText(file);
  }

  function resetDemo() {
    if (!window.confirm("Reiniciar datos de ejemplo?")) return;
    state = ensureState(seedState());
    saveState();
    toast("Demo reiniciada");
  }

  function loadCloudConfig() {
    let local = {};
    try {
      local = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || "{}");
    } catch {
      local = {};
    }
    const global = window.FINCABOT_CLOUD || {};
    return {
      supabaseUrl: local.supabaseUrl || global.supabaseUrl || "",
      supabaseAnonKey: local.supabaseAnonKey || global.supabaseAnonKey || ""
    };
  }

  function saveCloudConfig(config) {
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
  }

  function getSupabaseClient() {
    const config = loadCloudConfig();
    const signature = `${config.supabaseUrl}|${config.supabaseAnonKey}`;
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase?.createClient) {
      supabaseClient = null;
      supabaseConfigSignature = "";
      return null;
    }
    if (!supabaseClient || signature !== supabaseConfigSignature) {
      supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      supabaseConfigSignature = signature;
    }
    return supabaseClient;
  }

  async function initCloud() {
    const client = getSupabaseClient();
    if (!client) {
      cloudSession = null;
      updateCloudStatus();
      return;
    }
    const { data } = await client.auth.getSession();
    cloudSession = data.session;
    client.auth.onAuthStateChange(async (_event, session) => {
      cloudSession = session;
      if (session) await pullCloudState();
      updateCloudStatus();
    });
    if (cloudSession) await pullCloudState();
    updateCloudStatus();
  }

  async function handleCloudLogin() {
    saveCloudConfig({
      supabaseUrl: byId("settingSupabaseUrl").value.trim(),
      supabaseAnonKey: byId("settingSupabaseKey").value.trim()
    });
    const client = getSupabaseClient();
    const email = byId("cloudEmail").value.trim();
    if (!client) {
      toast("Configura Supabase URL y anon key");
      return;
    }
    if (!email) {
      toast("Introduce un email");
      return;
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
    if (error) {
      toast(error.message);
      return;
    }
    toast("Enlace enviado al email");
  }

  async function handleCloudLogout() {
    const client = getSupabaseClient();
    if (!client) return;
    await client.auth.signOut();
    cloudSession = null;
    cloudFarmId = null;
    updateCloudStatus();
    toast("Sesion cerrada");
  }

  async function pullCloudState() {
    const client = getSupabaseClient();
    if (!client || !cloudSession) return;
    const { data, error } = await client
      .from("farm_states")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      toast(`Nube: ${error.message}`);
      return;
    }
    if (!data) {
      await syncCloudNow(false);
      return;
    }
    cloudFarmId = data.id;
    const remote = ensureState(data.data);
    const remoteUpdated = remote.meta?.updatedAt || data.updated_at;
    const localUpdated = state.meta?.updatedAt || "";
    if (remoteUpdated > localUpdated) {
      state = remote;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      toast("Memoria nube cargada");
    } else if (localUpdated > remoteUpdated) {
      await syncCloudNow(false);
    }
    setupRealtime();
  }

  function queueCloudSync() {
    if (!cloudSession || !getSupabaseClient()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => syncCloudNow(false), 1200);
  }

  async function syncCloudNow(manual) {
    const client = getSupabaseClient();
    if (!client || !cloudSession || cloudSyncing) {
      if (manual) toast("Nube no conectada");
      return;
    }
    cloudSyncing = true;
    try {
      if (!cloudFarmId) {
        const { data } = await client
          .from("farm_states")
          .select("id")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        cloudFarmId = data?.id || null;
      }

      const payload = {
        owner_id: cloudSession.user.id,
        name: state.settings.farmName || "Mi finca",
        data: JSON.parse(JSON.stringify(state))
      };
      let result;
      if (cloudFarmId) {
        result = await client.from("farm_states").update(payload).eq("id", cloudFarmId).select("id").single();
      } else {
        result = await client.from("farm_states").insert(payload).select("id").single();
      }
      if (result.error) throw result.error;
      cloudFarmId = result.data.id;
      setupRealtime();
      if (manual) toast("Memoria sincronizada");
    } catch (error) {
      if (manual) toast(`Nube: ${error.message}`);
    } finally {
      cloudSyncing = false;
      updateCloudStatus();
    }
  }

  function setupRealtime() {
    const client = getSupabaseClient();
    if (!client || !cloudFarmId) return;
    if (cloudChannel) client.removeChannel(cloudChannel);
    cloudChannel = client
      .channel(`farm-state-${cloudFarmId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "farm_states",
        filter: `id=eq.${cloudFarmId}`
      }, (payload) => {
        const remote = ensureState(payload.new.data);
        const remoteUpdated = remote.meta?.updatedAt || payload.new.updated_at;
        if (remoteUpdated > (state.meta?.updatedAt || "")) {
          state = remote;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          render();
          toast("Memoria actualizada");
        }
      })
      .subscribe();
  }

  function updateCloudStatus() {
    const status = byId("cloudStatus");
    if (!status) return;
    const config = loadCloudConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      status.textContent = "Modo local";
      return;
    }
    status.textContent = cloudSession ? "Conectado y sincronizando" : "Nube configurada, falta entrar";
  }

  async function syncAppSheetNow(manual) {
    const url = state.settings.appsScriptUrl;
    if (!url) {
      toast("Configura la URL de Apps Script en Ajustes");
      updateSheetStatus();
      return;
    }
    sheetSyncState = { status: "syncing", message: "" };
    updateSheetStatus();
    try {
      const endpoint = new URL(url);
      endpoint.searchParams.set("fincabot", "1");
      endpoint.searchParams.set("productsTab", state.settings.sheetProductsTab || "PRODUCTOS");
      endpoint.searchParams.set("ordersTab", state.settings.sheetOrdersTab || "VENTA");
      endpoint.searchParams.set("saleLinesTab", state.settings.sheetSaleLinesTab || "VENTAS");
      endpoint.searchParams.set("clientsTab", state.settings.sheetClientsTab || "CLIENTES");
      endpoint.searchParams.set("harvestTab", state.settings.sheetHarvestTab || "LISTA RECOLECTA");
      if (state.settings.appsScriptToken) endpoint.searchParams.set("token", state.settings.appsScriptToken);
      const payload = await fetchSheetPayload(endpoint);
      if (payload && payload.ok === false) throw new Error(payload.error || "Apps Script devolvio error");
      importAppSheetPayload(payload);
      state.meta.sheetUpdatedAt = payload.updatedAt || new Date().toISOString();
      sheetSyncState = { status: "ready", message: "" };
      saveState();
      if (manual) toast("PEDIDOS CAMPO sincronizado");
    } catch (error) {
      sheetSyncState = { status: "error", message: error.message };
      updateSheetStatus();
      toast(`Hoja: ${error.message}`);
    }
  }

  async function fetchSheetPayload(endpoint) {
    try {
      const response = await fetch(endpoint.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      return loadJsonp(endpoint, error);
    }
  }

  function loadJsonp(endpoint, fetchError) {
    return new Promise((resolve, reject) => {
      const callbackName = `fincabotSheet_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(endpoint.toString());
      url.searchParams.set("callback", callbackName);
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        cleanup();
        const firstError = fetchError?.message ? ` Fetch: ${fetchError.message}.` : "";
        reject(new Error(`Apps Script no llamo al callback.${firstError} Prueba la URL con ?test=1&callback=prueba y revisa que devuelva prueba({...}).`));
      }, 60000);
      function cleanup() {
        clearTimeout(timeout);
        script.remove();
        delete window[callbackName];
      }
      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Apps Script no respondio"));
      };
      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  function importAppSheetPayload(payload) {
    const products = payload.products || payload[state.settings.sheetProductsTab] || [];
    const sales = payload.orders || payload.sales || payload[state.settings.sheetOrdersTab] || [];
    const saleLines = payload.saleLines || payload.lines || payload[state.settings.sheetSaleLinesTab] || [];
    const clients = payload.clients || payload[state.settings.sheetClientsTab] || [];
    const harvest = payload.harvest || payload.harvestList || payload[state.settings.sheetHarvestTab] || [];

    importProducts(products);
    importHarvestList(harvest);
    importOrdersFromSales(sales, saleLines, clients);
    syncCropPlantsFromFieldPlan();
  }

  function importProducts(rows) {
    const previousByKey = new Map(state.crops.map((crop) => [cropKey(crop.externalId, crop.name), crop]));
    const nextCrops = [];
    rows.forEach((row) => {
      const externalId = firstValue(row, ["Nº PRODUCTO", "N PRODUCTO", "ID", "id"]);
      const name = firstValue(row, ["PRODUCTO", "Producto", "producto"]);
      if (!name) return;
      const available = isYes(firstValue(row, ["TEMPORADA/DISPONIBLE", "DISPONIBLE", "TEMPORADA", "Disponible"]));
      const existing = previousByKey.get(cropKey(externalId, name)) || findCropByExternalId(externalId) || findCropByName(name);
      const crop = existing || {
        id: uid("crop"),
        plot: "PEDIDOS CAMPO",
        plants: 1,
        stage: available ? "Produccion" : "Compra",
        waterEveryDays: 2,
        weedEveryDays: 10,
        lastWatered: todayISO(),
        lastWeeded: todayISO(),
        yieldKgHour: 12,
        purchaseLeadDays: 3
      };
      crop.name = cleanProductName(name);
      crop.externalId = String(externalId || crop.externalId || "");
      crop.available = available;
      crop.fromDatabase = true;
      crop.plot = crop.plot || "PEDIDOS CAMPO";
      if (!existing) crop.source = available ? "cultivated" : "purchased";
      nextCrops.push(crop);
    });
    state.crops = dedupeCrops(nextCrops);
    clearMissingCropsFromFieldPlan();
  }

  function importHarvestList(rows) {
    state.harvestList = rows
      .map((row) => {
        const externalId = firstValue(row, ["ID", "Nº PRODUCTO", "N PRODUCTO"]);
        const productName = cleanProductName(firstValue(row, ["PRODUCTO", "Producto", "producto"]));
        const crop = findCropByExternalId(externalId) || findCropByName(productName);
        const kg = parseSpanishNumber(firstValue(row, ["KG", "Kg", "kg"]));
        const units = parseSpanishNumber(firstValue(row, ["UD", "Ud.", "UNIDADES", "Ud"]));
        return {
          id: `harvest_${externalId || normalizeProductName(productName)}`,
          cropId: crop?.id || "",
          productName,
          kg,
          units,
          dueDate: todayISO(),
          relation: firstValue(row, ["RELACION", "RELACIÓN"]) || "",
          status: "pending",
          externalId: String(externalId || "")
        };
      })
      .filter((item) => item.productName && (item.kg > 0 || item.units > 0));
  }

  function importOrdersFromSales(sales, saleLines, clients) {
    state.orders = [];
    if (!sales.length || !saleLines.length) return;
    const saleMap = new Map(sales.map((sale) => [String(firstValue(sale, ["Nº PAQUETE", "N PAQUETE", "Nº FACTURA", "N FACTURA"]) || ""), sale]));
    const clientMap = new Map(clients.map((client) => [String(firstValue(client, ["Nº CLIENTE", "N CLIENTE", "CLIENTE"]) || ""), client]));
    const today = todayISO();
    const imported = [];

    saleLines.forEach((line) => {
      const saleKey = String(firstValue(line, ["Nº VENTA", "N VENTA", "Nº PAQUETE", "N PAQUETE"]) || "");
      const sale = saleMap.get(saleKey) || {};
      const dueDate = parseSheetDate(firstValue(sale, ["FECHA REPARTO", "FECHA"]) || firstValue(line, ["FECHA"]));
      const statusText = normalizeText(`${firstValue(sale, ["ESTADO", "ESTADO PAQUETE"])} ${firstValue(line, ["ESTADO"])}`);
      if (dueDate < addDays(today, -1) && (statusText.includes("entregado") || statusText.includes("terminado"))) return;

      const productExternalId = firstValue(line, ["PRODUCTO", "Nº PRODUCTO", "N PRODUCTO"]);
      const crop = findCropByExternalId(productExternalId);
      if (!crop) return;
      const kg = parseSpanishNumber(firstValue(line, ["CANTIDAD", "Kg", "KG", "Ud."]));
      if (!kg) return;

      const clientId = String(firstValue(sale, ["CLIENTE"]) || firstValue(line, ["CLIENTE"]) || "");
      const client = clientMap.get(clientId) || {};
      const clientName = firstValue(sale, ["NICK"]) || firstValue(client, ["NICK", "NOMBRE"]) || `Cliente ${clientId}`;
      const address = firstValue(sale, ["UBICACIÓN", "UBICACION"]) || firstValue(client, ["DIRECCIÓN", "DIRECCION"]);
      imported.push({
        id: `order_${firstValue(line, ["ID VENTA", "ID"]) || saleKey}_${productExternalId}`,
        client: clientName,
        cropId: crop.id,
        kg,
        dueDate,
        priority: statusText.includes("urgente") ? 3 : 2,
        status: statusText.includes("entregado") ? "done" : "pending",
        zone: inferZone(address, clientName),
        deliveryMethod: "auto",
        externalId: String(firstValue(line, ["ID VENTA", "ID"]) || "")
      });
    });

    const existingById = new Map();
    imported.forEach((order) => existingById.set(order.id, order));
    state.orders = [...existingById.values()];
  }

  function firstValue(row, keys) {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
    }
    return "";
  }

  function parseSpanishNumber(value) {
    if (value === null || value === undefined) return 0;
    const text = String(value).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function parseSheetDate(value) {
    if (value instanceof Date) return toISO(value);
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return toISO(new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return todayISO();
  }

  function cropKey(externalId, name) {
    const id = String(externalId || "").trim();
    return id ? `id:${id}` : `name:${normalizeProductName(name)}`;
  }

  function dedupeCrops(crops) {
    const seen = new Set();
    return crops.filter((crop) => {
      const key = cropKey(crop.externalId, crop.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clearMissingCropsFromFieldPlan() {
    const ids = new Set(state.crops.map((crop) => crop.id));
    state.fieldSections.forEach((section) => {
      section.rivers.forEach((river) => {
        if (river.cropId && !ids.has(river.cropId)) {
          river.cropId = "";
          river.plantedPlants = 0;
        }
      });
    });
  }

  function isYes(value) {
    return normalizeText(value).startsWith("si") || normalizeText(value) === "yes";
  }

  function cleanProductName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeProductName(value) {
    return normalizeText(cleanProductName(value)).replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function findCropByExternalId(externalId) {
    const id = String(externalId || "").trim();
    if (!id) return null;
    return state.crops.find((crop) => String(crop.externalId || "") === id);
  }

  function inferZone(address, clientName) {
    const text = normalizeText(`${address || ""} ${clientName || ""}`);
    if (text.includes("cartagena")) return "cartagena";
    if (text.includes("murcia")) return "murcia";
    if (text.includes("alicante")) return "alicante";
    return "other";
  }

  function upsert(collection, item) {
    const index = collection.findIndex((current) => current.id === item.id);
    if (index >= 0) collection[index] = item;
    else collection.push(item);
  }

  function syncCropPlantsFromFieldPlan() {
    const totals = new Map();
    state.fieldSections.forEach((section) => {
      section.rivers.forEach((river) => {
        if (!river.cropId) return;
        totals.set(river.cropId, (totals.get(river.cropId) || 0) + Number(river.plantedPlants || 0));
      });
    });
    totals.forEach((plants, cropId) => {
      const crop = findCrop(cropId);
      if (crop && crop.source !== "purchased") crop.plants = plants;
    });
  }

  function findCrop(id) {
    return state.crops.find((crop) => crop.id === id);
  }

  function findCropByName(name) {
    const normalized = normalizeProductName(name);
    return state.crops.find((crop) => normalizeProductName(crop.name) === normalized);
  }

  function groupByCrop(orders) {
    return orders.reduce((map, order) => {
      const list = map.get(order.cropId) || [];
      list.push(order);
      map.set(order.cropId, list);
      return map;
    }, new Map());
  }

  function priorityLabel(priority) {
    return Number(priority) >= 3 ? "Prioridad alta" : Number(priority) === 2 ? "Prioridad media" : "Prioridad baja";
  }

  function sourceLabel(source) {
    return source === "purchased" ? "Comprado" : "Cultivado";
  }

  function deliveryMethodLabel(method) {
    if (method === "agency") return "Agencia";
    if (method === "own") return "Ruta propia";
    return "Auto";
  }

  function taskSkill(type) {
    const map = {
      harvest: "recoleccion",
      water: "riego",
      repair: "arreglos",
      admin: "general",
      general: "general"
    };
    return map[type] || "general";
  }

  function skillLabel(skill) {
    const map = {
      recoleccion: "Recoleccion",
      riego: "Riego",
      tratamientos: "Tratamientos",
      hierbas: "Hierbas",
      arreglos: "Arreglos",
      general: "General"
    };
    return map[skill] || skill;
  }

  function taskTypeLabel(type) {
    const map = {
      general: "General",
      repair: "Arreglo finca",
      admin: "Gestion",
      harvest: "Recoleccion",
      water: "Riego"
    };
    return map[type] || type;
  }

  function symptomLabel(symptom) {
    const map = {
      aphids: "Pulgon",
      thrips: "Trips",
      whitefly: "Mosca blanca",
      caterpillar: "Oruga",
      mites: "Arana roja",
      snails: "Caracoles o babosas",
      fungus: "Mancha u hongo",
      beneficial: "Insecto beneficioso",
      unknown: "Desconocido"
    };
    return map[symptom] || symptom;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(Number(value) || 0);
  }

  function toast(message) {
    const node = byId("toast");
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 2600);
  }

  function icon(name) {
    const paths = {
      drop: '<path d="M12 3s6 6.3 6 11a6 6 0 1 1-12 0c0-4.7 6-11 6-11Z"/>',
      leaf: '<path d="M5 21c8-1 14-7 14-17-8 0-14 6-14 14v3Z"/><path d="M5 21c3-5 7-9 13-12"/>',
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>',
      trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.check}</svg>`;
  }
})();

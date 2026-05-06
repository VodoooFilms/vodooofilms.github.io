import { ethers } from "https://esm.sh/ethers@6.13.5";

const CHAIN = {
  id: 11155111,
  name: "Sepolia",
  rpcUrl: "https://1rpc.io/sepolia",
  signalToken: "0x7cfBB6a8b34F4E247bb4d82ec15463EB7c9A83A3",
  arena: "0x0Ec0F1a5BaE2f6DC829D2f72ffB4d962C83b1EC1"
};

const ACTIVITY_LOOKBACK_BLOCKS = 9500;

const SIGNAL_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];

const ARENA_ABI = [
  "function agentCount() view returns (uint256)",
  "function duelCount() view returns (uint256)",
  "function agents(uint256) view returns (uint256 id, address creator, string name, string specialty, uint256 wins, uint256 losses, uint256 totalWagered, bool exists)",
  "function duels(uint256) view returns (uint256 id, uint256 agentA, uint256 agentB, string eventDescription, uint256 betDeadline, uint256 settleDeadline, uint256 totalPoolA, uint256 totalPoolB, uint256 winningAgent, uint8 state)",
  "function bets(uint256,address) view returns (uint256)",
  "function betAmounts(uint256,address) view returns (uint256)",
  "function claimed(uint256,address) view returns (bool)",
  "function bet(uint256,uint256,uint256)",
  "function claimWinnings(uint256)",
  "function claimRefund(uint256)",
  "function emergencyRefund(uint256)",
  "event BetPlaced(uint256 indexed duelId, address indexed bettor, uint256 agentId, uint256 amount)",
  "event DuelSettled(uint256 indexed duelId, uint256 winner)",
  "event EmergencyRefund(uint256 indexed duelId)",
  "event Refunded(uint256 indexed duelId, address indexed bettor, uint256 amount)",
  "event WinningsClaimed(uint256 indexed duelId, address indexed bettor, uint256 amount)"
];

const AGENT_METADATA = {
  doomgpt: {
    category: "Toby Original",
    verified: true,
    origin: "Toby",
    tagline: "Sees breakdowns before they trend."
  },
  bulltard: {
    category: "Toby Original",
    verified: true,
    origin: "Toby",
    tagline: "Always long. Occasionally right."
  },
  weatherwiz: {
    category: "Toby Original",
    verified: true,
    origin: "Toby",
    tagline: "Storm paths, pressure maps, zero drama."
  },
  hermes: {
    category: "Guest Agent",
    verified: true,
    origin: "External",
    tagline: "Reads the market before the market reads itself."
  },
  clawbot: {
    category: "Partner Agent",
    verified: true,
    origin: "Partner",
    tagline: "Fast, sharp, and allergic to hesitation."
  },
  pi: {
    category: "Community Agent",
    verified: false,
    origin: "Community",
    tagline: "Quiet math, sharp outcomes."
  }
};

const statusMap = {
  open: { label: "Abierto", className: "status-open" },
  settled: { label: "Finalizado", className: "status-settled" },
  refund_available: { label: "Reembolso", className: "status-refund" }
};

const positionMap = {
  active: { label: "Activa", className: "position-active" },
  won_claim_available: { label: "Cobrar ganancia", className: "position-won" },
  lost: { label: "Perdida", className: "position-lost" },
  refund_available: { label: "Cobrar reembolso", className: "position-refund" },
  claimed: { label: "Cobrada", className: "position-claimed" },
  refunded: { label: "Reembolsada", className: "position-refund" }
};

const page = document.body.dataset.page;

const appState = {
  account: null,
  readProvider: null,
  walletProvider: null,
  signer: null,
  signalRead: null,
  arenaRead: null,
  signalWrite: null,
  arenaWrite: null,
  data: null
};

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main class="shell">
      <section class="panel empty-state">
        <h1>No pude cargar Toby Bots Arena.</h1>
        <p>${error.message}</p>
      </section>
    </main>
  `;
});

async function init() {
  appState.readProvider = new ethers.JsonRpcProvider(CHAIN.rpcUrl);
  appState.signalRead = new ethers.Contract(CHAIN.signalToken, SIGNAL_ABI, appState.readProvider);
  appState.arenaRead = new ethers.Contract(CHAIN.arena, ARENA_ABI, appState.readProvider);

  await hydrateWalletState(false);
  await refreshApp();
}

async function hydrateWalletState(requestAccess) {
  if (!window.ethereum) return;

  appState.walletProvider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await window.ethereum.request({
    method: requestAccess ? "eth_requestAccounts" : "eth_accounts"
  });
  appState.account = accounts[0] || null;

  if (!appState.account) return;

  const network = await appState.walletProvider.getNetwork();
  if (Number(network.chainId) !== CHAIN.id) {
    throw new Error(`Conecta MetaMask a ${CHAIN.name} para usar la arena.`);
  }

  appState.signer = await appState.walletProvider.getSigner();
  appState.signalWrite = new ethers.Contract(CHAIN.signalToken, SIGNAL_ABI, appState.signer);
  appState.arenaWrite = new ethers.Contract(CHAIN.arena, ARENA_ABI, appState.signer);
}

async function refreshApp() {
  appState.data = await buildAppData(appState.account);
  setWalletSummary(appState.data.user);
  setNavState(page);

  if (page === "home") renderHome(appState.data, appState.data.agentsById);
  if (page === "explore") renderExplore(appState.data, appState.data.agentsById);
  if (page === "duel") renderDuel(appState.data, appState.data.agentsById);
  if (page === "agent") renderAgent(appState.data, appState.data.agentsById);
  if (page === "portfolio") renderPortfolio(appState.data);
}

async function buildAppData(account) {
  const [agentCountRaw, duelCountRaw] = await Promise.all([
    appState.arenaRead.agentCount(),
    appState.arenaRead.duelCount()
  ]);

  const agents = await Promise.all(
    Array.from({ length: Number(agentCountRaw) }, (_, index) => buildAgent(index + 1))
  );
  const agentsById = Object.fromEntries(agents.map((agent) => [agent.id, agent]));

  const rawDuels = await Promise.all(
    Array.from({ length: Number(duelCountRaw) }, (_, index) => appState.arenaRead.duels(index + 1))
  );
  const duels = await Promise.all(rawDuels.map((duel) => buildDuel(duel, agentsById, account)));
  const activities = await buildActivities(agentsById);

  return {
    meta: {
      productName: "Toby Bots Arena",
      tokenSymbol: "SIGNAL",
      network: CHAIN.name,
      contracts: {
        signalToken: CHAIN.signalToken,
        arena: CHAIN.arena
      },
      featuredDuelIds: [...duels]
        .sort((a, b) => b.pools.totalSignal - a.pools.totalSignal)
        .slice(0, 3)
        .map((duel) => duel.id)
    },
    user: await buildUser(account, duels),
    agents,
    agentsById,
    duels,
    activities
  };
}

async function buildAgent(id) {
  const raw = await appState.arenaRead.agents(id);
  const slug = raw.name.toLowerCase();
  const meta = AGENT_METADATA[slug] || {
    category: "Community Agent",
    verified: false,
    origin: "Community",
    tagline: `${raw.name} entra a la arena buscando su primer gran duelo.`
  };
  const wins = Number(raw.wins);
  const losses = Number(raw.losses);
  const totalMatches = wins + losses;

  return {
    id: String(raw.id),
    name: raw.name,
    slug,
    category: meta.category,
    verified: meta.verified,
    specialty: raw.specialty,
    tagline: meta.tagline,
    origin: meta.origin,
    record: {
      wins,
      losses,
      winRate: totalMatches ? Math.round((wins / totalMatches) * 100) : 0
    },
    stats: {
      totalBackedSignal: formatTokenNumber(raw.totalWagered),
      activeDuels: 0,
      streak: totalMatches ? `Récord ${wins}-${losses}` : "Sin historial"
    }
  };
}

async function buildDuel(rawDuel, agentsById, account) {
  const duelId = String(rawDuel.id);
  const agentAId = String(rawDuel.agentA);
  const agentBId = String(rawDuel.agentB);
  const totalPoolA = formatTokenNumber(rawDuel.totalPoolA);
  const totalPoolB = formatTokenNumber(rawDuel.totalPoolB);
  const totalSignal = totalPoolA + totalPoolB;
  const percentA = totalSignal ? Math.round((totalPoolA / totalSignal) * 100) : 50;
  const state = Number(rawDuel.state);

  const duel = {
    id: duelId,
    slug: `${agentAId}-${agentBId}-${duelId}`,
    title: `${agentsById[agentAId].name} vs ${agentsById[agentBId].name}`,
    status: state === 2 ? "settled" : state === 1 ? "refund_available" : "open",
    featured: false,
    agentAId,
    agentBId,
    prompt: rawDuel.eventDescription,
    summary: rawDuel.eventDescription,
    pools: {
      agentASignal: totalPoolA,
      agentBSignal: totalPoolB,
      totalSignal,
      agentAPercent: percentA,
      agentBPercent: 100 - percentA,
      totalBackers: 0
    },
    timing: {
      timeLeftLabel: deriveTimeLabel(rawDuel, state),
      betDeadlineIso: new Date(Number(rawDuel.betDeadline) * 1000).toISOString(),
      settleDeadlineIso: new Date(Number(rawDuel.settleDeadline) * 1000).toISOString()
    },
    result: {
      winnerAgentId: Number(rawDuel.winningAgent) > 0 ? String(rawDuel.winningAgent) : null,
      winnerDeclaredLabel: Number(rawDuel.winningAgent) > 0 ? agentsById[String(rawDuel.winningAgent)]?.name || null : null
    },
    userPosition: null
  };

  if (duel.status === "open") {
    agentsById[agentAId].stats.activeDuels += 1;
    agentsById[agentBId].stats.activeDuels += 1;
  }

  if (!account) return duel;

  const [betAgentRaw, betAmountRaw, claimed] = await Promise.all([
    appState.arenaRead.bets(duelId, account),
    appState.arenaRead.betAmounts(duelId, account),
    appState.arenaRead.claimed(duelId, account)
  ]);

  if (Number(betAgentRaw) === 0 || betAmountRaw === 0n) return duel;

  const selectedAgentId = String(betAgentRaw);
  const amountSignal = formatTokenNumber(betAmountRaw);
  const winner = duel.result.winnerAgentId;
  const won = winner && winner === selectedAgentId;

  let positionStatus = "active";
  let claimableSignal = 0;
  let refundSignal = 0;

  if (duel.status === "settled") {
    if (won && !claimed) {
      positionStatus = "won_claim_available";
      claimableSignal = calculatePayout(duel, selectedAgentId, amountSignal);
    } else if (won && claimed) {
      positionStatus = "claimed";
    } else {
      positionStatus = claimed ? "claimed" : "lost";
    }
  }

  if (duel.status === "refund_available") {
    positionStatus = claimed ? "refunded" : "refund_available";
    refundSignal = claimed ? 0 : amountSignal;
  }

  duel.userPosition = {
    selectedAgentId,
    selectedAgentName: agentsById[selectedAgentId]?.name || "Bot",
    amountSignal,
    status: positionStatus,
    claimableSignal,
    refundSignal
  };

  return duel;
}

async function buildUser(account, duels) {
  if (!account) {
    return {
      walletAddress: "Wallet no conectada",
      displayName: "Visitante",
      signalBalance: 0,
      summary: { totalBackedSignal: 0, claimableSignal: 0, refundableSignal: 0, lifetimeWinningsSignal: 0 },
      positions: []
    };
  }

  const signalBalance = formatTokenNumber(await appState.signalRead.balanceOf(account));
  const positions = duels
    .filter((duel) => duel.userPosition)
    .map((duel) => ({
      duelId: duel.id,
      duelTitle: duel.title,
      selectedAgentId: duel.userPosition.selectedAgentId,
      selectedAgentName: duel.userPosition.selectedAgentName,
      amountSignal: duel.userPosition.amountSignal,
      status: duel.userPosition.status,
      claimableSignal: duel.userPosition.claimableSignal,
      refundSignal: duel.userPosition.refundSignal
    }));

  return {
    walletAddress: account,
    displayName: "Arena Backer",
    signalBalance,
    summary: {
      totalBackedSignal: positions.reduce((sum, item) => sum + item.amountSignal, 0),
      claimableSignal: positions.reduce((sum, item) => sum + item.claimableSignal, 0),
      refundableSignal: positions.reduce((sum, item) => sum + item.refundSignal, 0),
      lifetimeWinningsSignal: 0
    },
    positions
  };
}

async function buildActivities(agentsById) {
  try {
    const latestBlock = await appState.readProvider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - ACTIVITY_LOOKBACK_BLOCKS);
    const [bets, settled, refunds, winnings, refundClaims] = await Promise.all([
      appState.arenaRead.queryFilter(appState.arenaRead.filters.BetPlaced(), fromBlock, latestBlock),
      appState.arenaRead.queryFilter(appState.arenaRead.filters.DuelSettled(), fromBlock, latestBlock),
      appState.arenaRead.queryFilter(appState.arenaRead.filters.EmergencyRefund(), fromBlock, latestBlock),
      appState.arenaRead.queryFilter(appState.arenaRead.filters.WinningsClaimed(), fromBlock, latestBlock),
      appState.arenaRead.queryFilter(appState.arenaRead.filters.Refunded(), fromBlock, latestBlock)
    ]);

    const events = [
      ...bets.map((event) => ({ type: "bet", event })),
      ...settled.map((event) => ({ type: "settled", event })),
      ...refunds.map((event) => ({ type: "refund-open", event })),
      ...winnings.map((event) => ({ type: "claim", event })),
      ...refundClaims.map((event) => ({ type: "refund-claim", event }))
    ].sort((a, b) => Number(b.event.blockNumber) - Number(a.event.blockNumber)).slice(0, 8);

    const timestamps = {};
    for (const item of events) {
      const blockNumber = Number(item.event.blockNumber);
      if (!timestamps[blockNumber]) {
        const block = await appState.readProvider.getBlock(blockNumber);
        timestamps[blockNumber] = new Date(Number(block.timestamp) * 1000).toISOString();
      }
    }

    return events.map(({ type, event }, index) => {
      const args = event.args || [];
      const duelId = String(args.duelId || "");
      let label = `Actividad en duelo #${duelId}`;

      if (type === "bet") {
        const agent = agentsById[String(args.agentId)];
        label = `${shortAddress(args.bettor)} respaldó a ${agent?.name || "un bot"} con ${formatTokenNumber(args.amount)} SIGNAL.`;
      }
      if (type === "settled") {
        label = `Ganador declarado: ${agentsById[String(args.winner)]?.name || "bot"} ganó el duelo #${duelId}.`;
      }
      if (type === "refund-open") {
        label = `Se abrieron reembolsos para el duelo #${duelId}.`;
      }
      if (type === "claim") {
        label = `${shortAddress(args.bettor)} cobró ${formatTokenNumber(args.amount)} SIGNAL en el duelo #${duelId}.`;
      }
      if (type === "refund-claim") {
        label = `${shortAddress(args.bettor)} recuperó ${formatTokenNumber(args.amount)} SIGNAL en el duelo #${duelId}.`;
      }

      return {
        id: `${type}-${index}`,
        duelId,
        agentIds: [],
        label,
        timestamp: timestamps[Number(event.blockNumber)]
      };
    });
  } catch (error) {
    console.warn("No pude leer actividad on-chain", error);
    return [];
  }
}

function setWalletSummary(user) {
  const wallet = document.getElementById("wallet-summary");
  if (!wallet) return;
  wallet.textContent = appState.account ? `${formatNumber(user.signalBalance)} SIGNAL` : "Conectar billetera";
  wallet.style.cursor = "pointer";
  wallet.onclick = () => (appState.account ? window.location.assign("./portfolio.html") : connectWallet());
}

function setNavState(current) {
  const navMap = { home: "home", explore: "explore", duel: "explore", agent: "agents", portfolio: "portfolio" };
  const navKey = navMap[current];
  if (!navKey) return;
  const link = document.querySelector(`[data-nav="${navKey}"]`);
  if (link) link.classList.add("active");
}

function renderHome(data, agentsById) {
  const featuredDuels = data.meta.featuredDuelIds
    .map((id) => data.duels.find((duel) => duel.id === id))
    .filter(Boolean);
  const topAgents = [...data.agents].sort((a, b) => b.stats.totalBackedSignal - a.stats.totalBackedSignal).slice(0, 4);
  const heroDuel = featuredDuels[0];
  const hero = document.getElementById("hero");
  hero.innerHTML = `
    <div class="hero-copy">
      <p class="eyebrow">Toby Bots Arena</p>
      <h1>Dos bots entran. Uno sale con todo.</h1>
      <p>Respaldá a los mejores agentes de IA en duelos de predicción. Si tu bot gana, ganás vos. Si el duelo expira sin veredicto, recuperas tu SIGNAL.</p>
      <div class="hero-pills">
        <span class="badge">Duelos en vivo</span>
        <span class="badge">Pools en SIGNAL</span>
        <span class="badge">Cobros y reembolsos</span>
      </div>
      <div class="hero-actions">
        <a class="button primary" href="./explore.html">Explorar duelos</a>
        <a class="button secondary" href="./how-it-works.html">Cómo funciona</a>
      </div>
    </div>
    <div class="hero-board">
      <div class="market-pulse">
        <div class="pulse-stack">
          <span class="metric-label">Duelo destacado</span>
          <strong>${heroDuel ? formatNumber(heroDuel.pools.totalSignal) : "0"} SIGNAL</strong>
          <span class="metric-label">${heroDuel ? `${heroDuel.title} · ${formatTimeLeft(heroDuel.timing.timeLeftLabel)}` : "Sin duelos destacados"}</span>
        </div>
        ${heroDuel ? `<span class="status-pill ${statusMap[heroDuel.status].className}">${statusMap[heroDuel.status].label}</span>` : ""}
      </div>
      <div class="mini-board">
        ${featuredDuels.map((duel) => miniDuelRowMarkup(duel, agentsById)).join("")}
      </div>
    </div>
  `;

  document.getElementById("home-overview").innerHTML = `
    ${summaryMetric("Duelos abiertos", data.duels.filter((duel) => duel.status === "open").length)}
    ${summaryMetric("Pool activo", `${formatNumber(data.duels.filter((duel) => duel.status === "open").reduce((sum, duel) => sum + duel.pools.totalSignal, 0))} SIGNAL`)}
    ${summaryMetric("Ganancia por cobrar", `${formatNumber(data.user.summary.claimableSignal)} SIGNAL`)}
    ${summaryMetric("Red", data.meta.network)}
  `;

  document.getElementById("featured-duels").innerHTML = featuredDuels.map((duel) => duelCardMarkup(duel, agentsById)).join("");
  document.getElementById("top-agents").innerHTML = topAgents.map((agent) => agentCardMarkup(agent)).join("");
  document.getElementById("activity-feed").innerHTML = data.activities.length
    ? data.activities.slice(0, 5).map(activityMarkup).join("")
    : "<div class=\"activity-row\"><span>Sin actividad reciente en chain.</span><span>ahora</span></div>";
}

function renderExplore(data, agentsById) {
  const statusFilter = document.getElementById("status-filter");
  const searchFilter = document.getElementById("search-filter");
  const grid = document.getElementById("explore-grid");
  const empty = document.getElementById("explore-empty");
  const overview = document.getElementById("market-overview");

  overview.innerHTML = `
    ${overviewCardMarkup("Duelos abiertos", data.duels.filter((duel) => duel.status === "open").length, "Leído desde Sepolia")}
    ${overviewCardMarkup("Duelos finalizados", data.duels.filter((duel) => duel.status === "settled").length, "Estado real del contrato")}
    ${overviewCardMarkup("Volumen total", `${formatNumber(data.duels.reduce((sum, duel) => sum + duel.pools.totalSignal, 0))} SIGNAL`, "Sepolia live")}
    ${overviewCardMarkup("Tus posiciones", data.user.positions.length, appState.account ? "Wallet conectada" : "Conecta wallet")}
  `;

  const rerender = () => {
    const status = statusFilter.value;
    const query = searchFilter.value.trim().toLowerCase();
    const filtered = data.duels.filter((duel) => {
      const agentA = agentsById[duel.agentAId];
      const agentB = agentsById[duel.agentBId];
      const matchesStatus = status === "all" || duel.status === status;
      const haystack = `${duel.title} ${duel.prompt} ${agentA.name} ${agentB.name}`.toLowerCase();
      return matchesStatus && (!query || haystack.includes(query));
    });

    grid.innerHTML = filtered.map((duel) => duelCardMarkup(duel, agentsById)).join("");
    empty.classList.toggle("hidden", filtered.length > 0);
  };

  statusFilter.addEventListener("change", rerender);
  searchFilter.addEventListener("input", rerender);
  rerender();
}

function renderDuel(data, agentsById) {
  const params = new URLSearchParams(window.location.search);
  const duel = data.duels.find((item) => item.id === (params.get("id") || data.duels[0]?.id)) || data.duels[0];
  const agentA = agentsById[duel.agentAId];
  const agentB = agentsById[duel.agentBId];
  const position = duel.userPosition;
  const status = statusMap[duel.status];
  const view = document.getElementById("duel-view");
  const inputDisabled = duel.status !== "open" || !!position || !appState.account;

  view.innerHTML = `
    <section class="duel-column">
      <article class="panel matchup-hero">
        <div class="card-meta">
          <span class="status-pill ${status.className}">${status.label}</span>
          <span class="metric-label">${formatTimeLeft(duel.timing.timeLeftLabel)}</span>
        </div>
        <h1>${duel.title}</h1>
        <p>${duel.prompt}</p>
        <div class="detail-bots">
          ${detailBotMarkup(agentA, duel.pools.agentAPercent)}
          <div class="vs-marker">VS</div>
          ${detailBotMarkup(agentB, duel.pools.agentBPercent)}
        </div>
      </article>

      <article class="panel detail-section">
        <h2>Pool del duelo</h2>
        <div class="split-bar"><div class="split-fill" style="width: ${duel.pools.agentAPercent}%"></div></div>
        <div class="stats-row">
          <strong>${agentA.name} ${duel.pools.agentAPercent}%</strong>
          <strong>${agentB.name} ${duel.pools.agentBPercent}%</strong>
        </div>
        <div class="metric-grid">
          ${summaryMetric("Pool total", `${formatNumber(duel.pools.totalSignal)} SIGNAL`)}
          ${summaryMetric(`Pool ${agentA.name}`, `${formatNumber(duel.pools.agentASignal)} SIGNAL`)}
          ${summaryMetric(`Pool ${agentB.name}`, `${formatNumber(duel.pools.agentBSignal)} SIGNAL`)}
          ${summaryMetric("Duel ID", duel.id)}
        </div>
      </article>

      <article class="panel detail-section">
        <h2>Reglas y timing</h2>
        <ul>
          <li>Las apuestas cierran el ${formatIso(duel.timing.betDeadlineIso)}.</li>
          <li>La ventana de veredicto cierra el ${formatIso(duel.timing.settleDeadlineIso)}.</li>
          <li>Si el duelo expira sin veredicto, cualquier wallet puede abrir reembolsos con emergencyRefund().</li>
          <li>Una wallet solo puede respaldar una vez por duelo en el contrato actual.</li>
        </ul>
      </article>

      <article class="panel detail-section">
        <h2>Actividad del duelo</h2>
        <div class="activity-list">
          ${data.activities.filter((activity) => activity.duelId === duel.id).slice(0, 4).map(activityMarkup).join("") || "<div class=\"activity-row\"><span>Sin actividad visible todavía.</span><span>ahora</span></div>"}
        </div>
      </article>
    </section>
    <aside class="panel action-panel">
      <p class="eyebrow">Panel de acción</p>
      <h3>${actionHeading(duel, position, agentA, agentB)}</h3>
      <p>${actionDescription(duel, position)}</p>
      <div class="action-state">
        <div class="choice-grid">
          ${choiceMarkup(agentA, duel.pools.agentAPercent, position)}
          ${choiceMarkup(agentB, duel.pools.agentBPercent, position)}
        </div>
        <label>
          Monto
          <input id="bet-amount-input" type="number" min="1" step="1" value="${position?.amountSignal || 250}" ${inputDisabled ? "disabled" : ""} />
        </label>
        <div class="action-summary">
          ${summaryLine("Balance", `${formatNumber(data.user.signalBalance)} SIGNAL`)}
          ${summaryLine("Estado", position ? positionMap[position.status].label : status.label)}
          ${position?.claimableSignal ? summaryLine("Ganancia", `${formatNumber(position.claimableSignal)} SIGNAL`) : ""}
          ${position?.refundSignal ? summaryLine("Reembolso", `${formatNumber(position.refundSignal)} SIGNAL`) : ""}
        </div>
        <button id="duel-action-button" class="button primary">${actionButton(duel, position)}</button>
      </div>
    </aside>
  `;

  bindDuelInteractions(duel, position, agentA);
}

function bindDuelInteractions(duel, position, defaultAgent) {
  const button = document.getElementById("duel-action-button");
  if (!button) return;

  if (!appState.account) {
    button.onclick = connectWallet;
    return;
  }

  if (duel.status === "open" && !position) {
    const choices = [...document.querySelectorAll(".choice-button")];
    let selectedAgentId = defaultAgent.id;
    choices.forEach((choice) => {
      choice.addEventListener("click", () => {
        choices.forEach((item) => item.classList.remove("selected"));
        choice.classList.add("selected");
        selectedAgentId = choice.dataset.agentId;
      });
    });

    button.onclick = async () => {
      const amountInput = document.getElementById("bet-amount-input");
      const amount = amountInput.value;
      if (!amount || Number(amount) <= 0) {
        alert("Ingresa un monto válido.");
        return;
      }

      await submitArenaAction(button, async () => {
        const amountWei = ethers.parseUnits(amount, 18);
        const allowance = await appState.signalWrite.allowance(appState.account, CHAIN.arena);
        if (allowance < amountWei) {
          const approveTx = await appState.signalWrite.approve(CHAIN.arena, amountWei);
          await approveTx.wait();
        }
        return appState.arenaWrite.bet(duel.id, selectedAgentId, amountWei);
      });
    };
    return;
  }

  if (position?.status === "won_claim_available") {
    button.onclick = async () => submitArenaAction(button, () => appState.arenaWrite.claimWinnings(duel.id));
    return;
  }

  if (position?.status === "refund_available") {
    button.onclick = async () => submitArenaAction(button, () => appState.arenaWrite.claimRefund(duel.id));
    return;
  }

  if (duel.status === "refund_available" && !position) {
    button.onclick = async () => submitArenaAction(button, () => appState.arenaWrite.emergencyRefund(duel.id));
    return;
  }

  button.disabled = duel.status === "open" && !!position;
  button.onclick = () => window.location.assign("./portfolio.html");
}

async function submitArenaAction(button, callback) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Enviando...";
  try {
    const tx = await callback();
    await tx.wait();
    await refreshApp();
  } catch (error) {
    console.error(error);
    alert(error.shortMessage || error.message || "No pude completar la transacción.");
    button.disabled = false;
    button.textContent = label;
  }
}

function renderAgent(data, agentsById) {
  const params = new URLSearchParams(window.location.search);
  const agent = data.agents.find((item) => item.id === (params.get("id") || data.agents[0].id)) || data.agents[0];
  const duels = data.duels.filter((duel) => duel.agentAId === agent.id || duel.agentBId === agent.id);
  const activities = data.activities.filter((activity) => activity.label.includes(agent.name));
  const view = document.getElementById("agent-view");

  view.innerHTML = `
    <section class="panel agent-hero">
      <div class="agent-meta">
        <div class="avatar large">${initials(agent.name)}</div>
        <div>
          <p class="eyebrow">${translateOrigin(agent.origin)}</p>
          <h1>${agent.name}</h1>
          <div class="card-matchup">
            <span class="badge">${translateCategory(agent.category)}</span>
            ${agent.verified ? '<span class="badge">Verificado</span>' : '<span class="badge">No verificado</span>'}
          </div>
          <p>${agent.tagline}</p>
        </div>
      </div>
      <div class="hero-actions">
        <a class="button primary" href="./explore.html">Ver duelos</a>
        <a class="button secondary" href="./duel.html?id=${duels[0]?.id || ""}">Abrir duelo</a>
      </div>
    </section>

    <section class="summary-grid">
      ${summaryMetric("Victorias", agent.record.wins)}
      ${summaryMetric("Derrotas", agent.record.losses)}
      ${summaryMetric("Efectividad", `${agent.record.winRate}%`)}
      ${summaryMetric("Total respaldado", `${formatNumber(agent.stats.totalBackedSignal)} SIGNAL`)}
    </section>

    <section class="panel detail-section">
      <h2>Sobre este agente</h2>
      <p><strong>Especialidad:</strong> ${agent.specialty}</p>
      <p><strong>Origen:</strong> ${translateOrigin(agent.origin)}</p>
      <p><strong>Racha actual:</strong> ${agent.stats.streak}</p>
      <p><strong>Duelos abiertos:</strong> ${agent.stats.activeDuels}</p>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Duelos recientes</h2>
      </div>
      <div class="card-grid">${duels.map((duel) => duelCardMarkup(duel, agentsById)).join("")}</div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>Actividad reciente</h2>
      </div>
      <div class="activity-list panel">${activities.length ? activities.map(activityMarkup).join("") : "<div class=\"activity-row\"><span>Sin actividad visible todavía.</span><span>ahora</span></div>"}</div>
    </section>
  `;
}

function renderPortfolio(data) {
  const grouped = {
    open: data.user.positions.filter((position) => position.status === "active"),
    winnings: data.user.positions.filter((position) => position.status === "won_claim_available"),
    refunds: data.user.positions.filter((position) => position.status === "refund_available"),
    history: data.user.positions.filter((position) => !["active", "won_claim_available", "refund_available"].includes(position.status))
  };

  const view = document.getElementById("portfolio-view");
  view.innerHTML = `
    <section class="portfolio-header">
      <article class="panel page-intro">
        <p class="eyebrow">Historial de arena</p>
        <h1>Gestiona tus posiciones y cobros.</h1>
        <p>${data.user.walletAddress}</p>
      </article>
      <div class="summary-grid">
        ${summaryMetric("Balance SIGNAL", `${formatNumber(data.user.signalBalance)} SIGNAL`)}
        ${summaryMetric("Total respaldado", `${formatNumber(data.user.summary.totalBackedSignal)} SIGNAL`)}
        ${summaryMetric("Ganancia disponible", `${formatNumber(data.user.summary.claimableSignal)} SIGNAL`)}
        ${summaryMetric("Reembolso disponible", `${formatNumber(data.user.summary.refundableSignal)} SIGNAL`)}
      </div>
    </section>

    <section class="panel portfolio-card">
      <div class="tabs">
        <button class="tab active" data-tab="open">Posiciones abiertas</button>
        <button class="tab" data-tab="winnings">Cobrar ganancias</button>
        <button class="tab" data-tab="refunds">Cobrar reembolsos</button>
        <button class="tab" data-tab="history">Historial</button>
      </div>
      <div id="tab-content"></div>
    </section>
  `;

  const tabContent = document.getElementById("tab-content");
  const tabs = [...document.querySelectorAll(".tab")];
  const renderTab = (key) => {
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === key));
    const rows = grouped[key];
    tabContent.innerHTML = rows.length
      ? `<div class="positions-grid">${rows.map(positionMarkup).join("")}</div>`
      : `<div class="empty-state"><h3>No hay movimientos en esta sección.</h3><p>${appState.account ? "Todavía no tienes posiciones para mostrar aquí." : "Conecta tu wallet para ver tus posiciones reales."}</p></div>`;
  };

  tabs.forEach((tab) => tab.addEventListener("click", () => renderTab(tab.dataset.tab)));
  renderTab("open");
}

function duelCardMarkup(duel, agentsById, compact = false) {
  const agentA = agentsById[duel.agentAId];
  const agentB = agentsById[duel.agentBId];
  const status = statusMap[duel.status];
  return `
    <article class="duel-card">
      <div class="card-meta">
        <span class="status-pill ${status.className}">${status.label}</span>
        <span class="metric-label">${formatTimeLeft(duel.timing.timeLeftLabel)}</span>
      </div>
      <h3>${duel.title}</h3>
      <div class="duel-bots">
        <div class="bot-line">
          <span class="avatar">${initials(agentA.name)}</span>
          <div>
            <strong>${agentA.name}</strong>
            <div class="metric-label">${translateCategory(agentA.category)}</div>
          </div>
        </div>
        <div class="bot-line">
          <span class="avatar">${initials(agentB.name)}</span>
          <div>
            <strong>${agentB.name}</strong>
            <div class="metric-label">${translateCategory(agentB.category)}</div>
          </div>
        </div>
      </div>
      <p>${duel.prompt}</p>
      <div class="outcome-book">
        <div class="outcome-row">
          <span>${agentA.name}</span>
          <strong>${duel.pools.agentAPercent}%</strong>
        </div>
        <div class="outcome-row">
          <span>${agentB.name}</span>
          <strong>${duel.pools.agentBPercent}%</strong>
        </div>
      </div>
      <div class="split-bar"><div class="split-fill" style="width: ${duel.pools.agentAPercent}%"></div></div>
      <div class="trade-actions">
        <a class="trade-button yes" href="./duel.html?id=${duel.id}">${compact ? "Abrir" : agentA.name}</a>
        <a class="trade-button no" href="./duel.html?id=${duel.id}">${compact ? "Ver duelo" : agentB.name}</a>
      </div>
      <div class="card-footer">
        <div class="metric-copy">Pool ${formatNumber(duel.pools.totalSignal)} SIGNAL</div>
        <div class="metric-label">${duel.result.winnerDeclaredLabel ? `Ganó ${duel.result.winnerDeclaredLabel}` : "Sepolia live"}</div>
      </div>
    </article>
  `;
}

function miniDuelRowMarkup(duel, agentsById) {
  const agentA = agentsById[duel.agentAId];
  const agentB = agentsById[duel.agentBId];
  return `
    <a class="mini-row" href="./duel.html?id=${duel.id}">
      <div>
        <strong>${duel.title}</strong>
        <span>${agentA.name} ${duel.pools.agentAPercent}% · ${agentB.name} ${duel.pools.agentBPercent}%</span>
      </div>
      <span>${formatTimeLeft(duel.timing.timeLeftLabel)}</span>
    </a>
  `;
}

function overviewCardMarkup(label, value, detail) {
  return `<article class="overview-card panel"><span class="metric-label">${label}</span><strong>${value}</strong><p>${detail}</p></article>`;
}

function agentCardMarkup(agent) {
  return `
    <article class="agent-card">
      <div class="avatar large">${initials(agent.name)}</div>
      <h3>${agent.name}</h3>
      <span class="badge">${translateCategory(agent.category)}</span>
      <p>${agent.specialty}</p>
      <div class="stats-row"><span class="metric-label">Récord</span><strong>${agent.record.wins}W - ${agent.record.losses}L</strong></div>
      <div class="stats-row"><span class="metric-label">Respaldado</span><strong>${formatNumber(agent.stats.totalBackedSignal)} SIGNAL</strong></div>
      <a class="button secondary" href="./agent.html?id=${agent.id}">Ver perfil</a>
    </article>
  `;
}

function activityMarkup(activity) {
  return `<div class="activity-row"><span>${activity.label}</span><span>${relativeTimestamp(activity.timestamp)}</span></div>`;
}

function positionMarkup(position) {
  const state = positionMap[position.status];
  const action = position.status === "won_claim_available" ? "Cobrar ganancia" : position.status === "refund_available" ? "Cobrar reembolso" : "Ver duelo";
  return `
    <div class="position-row">
      <div>
        <strong>${position.duelTitle}</strong>
        <div class="metric-label">${position.selectedAgentName} · ${formatNumber(position.amountSignal)} SIGNAL</div>
      </div>
      <div class="card-matchup">
        <span class="status-pill ${state.className}">${state.label}</span>
        <a class="button secondary" href="./duel.html?id=${position.duelId}">${action}</a>
      </div>
    </div>
  `;
}

function detailBotMarkup(agent, percent) {
  return `
    <div class="bot-panel">
      <div class="bot-line">
        <span class="avatar large">${initials(agent.name)}</span>
        <div>
          <strong>${agent.name}</strong>
          <div class="metric-label">${translateCategory(agent.category)}</div>
        </div>
      </div>
      <h3>${percent}% del pool</h3>
      <p>${agent.tagline}</p>
      <div class="stats-row"><span class="metric-label">Récord</span><strong>${agent.record.wins}W - ${agent.record.losses}L</strong></div>
    </div>
  `;
}

function choiceMarkup(agent, percent, position) {
  const selected = position?.selectedAgentId === agent.id ? "selected" : "";
  return `<div class="choice-button ${selected}" data-agent-id="${agent.id}"><span>${agent.name}</span><strong>${percent}%</strong></div>`;
}

function actionHeading(duel, position, agentA, agentB) {
  if (!appState.account) return "Conecta tu wallet";
  if (duel.status === "open" && !position) return "Respalda un bot";
  if (position?.status === "won_claim_available") return `Cobrar victoria de ${agentName(position.selectedAgentId, agentA, agentB)}`;
  if (position?.status === "refund_available") return "Cobrar reembolso";
  if (duel.status === "refund_available" && !position) return "Abrir refunds";
  return "Duelo cerrado";
}

function actionDescription(duel, position) {
  if (!appState.account) return "Conecta MetaMask en Sepolia para ver tus posiciones reales y operar con SIGNAL.";
  if (duel.status === "open" && !position) return "Aprueba SIGNAL, elige un lado y entra al duelo antes del cierre.";
  if (position?.status === "won_claim_available") return "Esta posición ganó. Tu payout ya está listo para cobrar.";
  if (position?.status === "refund_available") return "Este duelo expiró sin veredicto. Tu apuesta original puede volver a tu wallet.";
  if (duel.status === "refund_available" && !position) return "El duelo venció sin settlement. Cualquier wallet puede desbloquear refunds.";
  if (duel.status === "settled") return "El ganador ya fue declarado. Los backers ganadores pueden cobrar y los demás revisar el resultado.";
  return "Este duelo quedó cerrado para reembolsos individuales.";
}

function actionButton(duel, position) {
  if (!appState.account) return "Conectar billetera";
  if (duel.status === "open" && !position) return "Aprobar y respaldar";
  if (position?.status === "won_claim_available") return "Cobrar ganancia";
  if (position?.status === "refund_available") return "Cobrar reembolso";
  if (duel.status === "refund_available" && !position) return "Abrir refunds";
  if (duel.status === "open" && position) return "Ya participas";
  return "Ver portfolio";
}

function summaryMetric(label, value) {
  return `<article class="summary-card"><span class="metric-label">${label}</span><strong>${value}</strong></article>`;
}

function summaryLine(label, value) {
  return `<div class="summary-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value * 100) / 100);
}

function formatTokenNumber(value) {
  return Number(ethers.formatEther(value));
}

function formatIso(value) {
  return new Intl.DateTimeFormat("es-EC", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function relativeTimestamp(value) {
  const diffMinutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  return `hace ${Math.round(diffHours / 24)} d`;
}

function formatTimeLeft(value) {
  if (value === "Settled") return "Finalizado";
  if (value === "Winner declared") return "Ganador declarado";
  if (value === "Refund available") return "Reembolso disponible";
  if (value.includes("left")) return value.replace(" left", " restantes");
  return value;
}

function deriveTimeLabel(rawDuel, state) {
  const now = Math.floor(Date.now() / 1000);
  const betDeadline = Number(rawDuel.betDeadline);
  const settleDeadline = Number(rawDuel.settleDeadline);
  if (state === 2) return "Winner declared";
  if (state === 1) return "Refund available";
  if (now <= betDeadline) {
    const remaining = betDeadline - now;
    const hours = Math.floor(remaining / 3600);
    if (hours >= 24) return `${Math.floor(hours / 24)}d left`;
    if (hours >= 1) return `${hours}h left`;
    return `${Math.max(1, Math.floor(remaining / 60))}m left`;
  }
  if (now <= settleDeadline) return "Esperando veredicto";
  return "Refund available";
}

function translateCategory(value) {
  return {
    "Guest Agent": "Agente invitado",
    "Partner Agent": "Agente partner",
    "Community Agent": "Agente comunidad",
    "Toby Original": "Original Toby"
  }[value] || value;
}

function translateOrigin(value) {
  return {
    External: "Invitado",
    Partner: "Partner",
    Community: "Comunidad",
    Toby: "Toby"
  }[value] || value;
}

function calculatePayout(duel, selectedAgentId, amountSignal) {
  const winnerPool = selectedAgentId === duel.agentAId ? duel.pools.agentASignal : duel.pools.agentBSignal;
  const prizePool = duel.pools.totalSignal * 0.98;
  return winnerPool ? Math.floor((amountSignal / winnerPool) * prizePool) : 0;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
}

function agentName(agentId, agentA, agentB) {
  if (agentA.id === agentId) return agentA.name;
  if (agentB.id === agentId) return agentB.name;
  return "bot";
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "wallet";
}

async function connectWallet() {
  try {
    await hydrateWalletState(true);
    await refreshApp();
  } catch (error) {
    console.error(error);
    alert(error.message || "No pude conectar la wallet.");
  }
}

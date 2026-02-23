// Marvis Trading Dashboard - Frontend Application
(() => {

  // ============= State =============

  const state = {
    /** @type {Map<string, TickerData>} */
    tickers: new Map(),
    /** @type {WebSocket | null} */
    ws: null,
    /** @type {number | null} */
    pollInterval: null,
    connected: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    reconnectDelay: 2000,
  };

  /**
   * @typedef {Object} TickerData
   * @property {string} symbol
   * @property {string} lastPrice
   * @property {string} priceChange
   * @property {string} priceChangePercent
   * @property {string} highPrice
   * @property {string} lowPrice
   * @property {string} volume
   * @property {string} [previousPrice]
   */

  // ============= DOM Elements =============

  const tickerBody = document.getElementById("tickerBody");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const lastUpdated = document.getElementById("lastUpdated");
  const errorDiv = document.getElementById("error");

  // ============= Formatting =============

  function formatPrice(price) {
    const num = Number.parseFloat(price);
    if (num >= 1000) return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    return num.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
  }

  function formatVolume(volume) {
    const num = Number.parseFloat(volume);
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
  }

  function formatChange(percent) {
    const num = Number.parseFloat(percent);
    const sign = num >= 0 ? "+" : "";
    return `${sign + num.toFixed(2)}%`;
  }

  function getChangeClass(percent) {
    const num = Number.parseFloat(percent);
    if (num > 0) return "positive";
    if (num < 0) return "negative";
    return "neutral";
  }

  // ============= Rendering =============

  function renderTable() {
    if (state.tickers.size === 0) {
      tickerBody.innerHTML = '<tr><td colspan="6" class="loading">No data available</td></tr>';
      return;
    }

    // Sort by quote volume descending (most traded first)
    const sorted = Array.from(state.tickers.values()).sort((a, b) => {
      return Number.parseFloat(b.volume) - Number.parseFloat(a.volume);
    });

    tickerBody.innerHTML = sorted
      .map((ticker) => {
        const changeClass = getChangeClass(ticker.priceChangePercent);
        const flashClass = getFlashClass(ticker);
        return `
        <tr data-symbol="${ticker.symbol}">
          <td class="symbol">${ticker.symbol}</td>
          <td class="price ${flashClass}">${formatPrice(ticker.lastPrice)}</td>
          <td class="${changeClass}">${formatChange(ticker.priceChangePercent)}</td>
          <td>${formatPrice(ticker.highPrice)}</td>
          <td>${formatPrice(ticker.lowPrice)}</td>
          <td class="volume">${formatVolume(ticker.volume)}</td>
        </tr>`;
      })
      .join("");

    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  }

  function getFlashClass(ticker) {
    if (!ticker.previousPrice) return "";
    const prev = Number.parseFloat(ticker.previousPrice);
    const curr = Number.parseFloat(ticker.lastPrice);
    if (curr > prev) return "flash-up";
    if (curr < prev) return "flash-down";
    return "";
  }

  function updateSinglePrice(symbol, price) {
    const ticker = state.tickers.get(symbol);
    if (ticker) {
      ticker.previousPrice = ticker.lastPrice;
      ticker.lastPrice = price;

      // Update just the affected row instead of re-rendering everything
      const row = tickerBody.querySelector(`tr[data-symbol="${symbol}"]`);
      if (row) {
        const priceCell = row.querySelector(".price");
        if (priceCell) {
          priceCell.textContent = formatPrice(price);
          priceCell.className = `price ${getFlashClass(ticker)}`;
        }
        lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
        return;
      }
    }

    // If row not found, do a full re-render
    renderTable();
  }

  function setStatus(connected, text) {
    state.connected = connected;
    statusDot.className = `status-dot${connected ? " connected" : ""}`;
    statusText.textContent = text;
  }

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    setTimeout(() => {
      errorDiv.style.display = "none";
    }, 5000);
  }

  // ============= Data Fetching =============

  async function fetchInitialData() {
    try {
      const response = await fetch("/api/stats");
      const result = await response.json();

      if (!result.success) {
        showError(`Failed to fetch data: ${result.error}`);
        return;
      }

      for (const stat of result.data) {
        state.tickers.set(stat.symbol, {
          symbol: stat.symbol,
          lastPrice: stat.lastPrice,
          priceChange: stat.priceChange,
          priceChangePercent: stat.priceChangePercent,
          highPrice: stat.highPrice,
          lowPrice: stat.lowPrice,
          volume: stat.volume,
        });
      }

      renderTable();
    } catch (err) {
      showError(`Failed to connect to server: ${err.message}`);
    }
  }

  // ============= WebSocket =============

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      state.ws = new WebSocket(wsUrl);

      state.ws.onopen = () => {
        setStatus(true, "Live");
        state.reconnectAttempts = 0;

        // Stop polling if it was running as fallback
        if (state.pollInterval) {
          clearInterval(state.pollInterval);
          state.pollInterval = null;
        }
      };

      state.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "price_update" && message.data) {
            updateSinglePrice(message.data.symbol, message.data.price);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      state.ws.onclose = () => {
        setStatus(false, "Disconnected");
        scheduleReconnect();
      };

      state.ws.onerror = () => {
        setStatus(false, "Connection error");
      };
    } catch {
      setStatus(false, "WebSocket not available");
      startPolling();
    }
  }

  function scheduleReconnect() {
    if (state.reconnectAttempts >= state.maxReconnectAttempts) {
      setStatus(false, "Reconnection failed — polling");
      startPolling();
      return;
    }

    state.reconnectAttempts++;
    const delay = state.reconnectDelay * Math.min(state.reconnectAttempts, 5);
    setStatus(false, `Reconnecting in ${Math.round(delay / 1000)}s...`);

    setTimeout(() => {
      connectWebSocket();
    }, delay);
  }

  // ============= Polling Fallback =============

  function startPolling() {
    if (state.pollInterval) return;

    state.pollInterval = setInterval(async () => {
      try {
        const response = await fetch("/api/stats");
        const result = await response.json();

        if (result.success) {
          for (const stat of result.data) {
            const existing = state.tickers.get(stat.symbol);
            if (existing) {
              existing.previousPrice = existing.lastPrice;
            }
            state.tickers.set(stat.symbol, {
              ...state.tickers.get(stat.symbol),
              symbol: stat.symbol,
              lastPrice: stat.lastPrice,
              priceChange: stat.priceChange,
              priceChangePercent: stat.priceChangePercent,
              highPrice: stat.highPrice,
              lowPrice: stat.lowPrice,
              volume: stat.volume,
              previousPrice: existing ? existing.lastPrice : undefined,
            });
          }
          renderTable();
          setStatus(true, "Polling (5s)");
        }
      } catch {
        setStatus(false, "Polling failed");
      }
    }, 5000);
  }

  // ============= Init =============

  async function init() {
    setStatus(false, "Loading...");
    await fetchInitialData();
    connectWebSocket();
  }

  init();
})();

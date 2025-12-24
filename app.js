(() => {
  const MAX_LINES = 1000;
  const scrollback = document.getElementById("scrollback");
  const promptRow = document.getElementById("promptRow");
  const promptInput = document.getElementById("promptInput");
  const promptUser = document.getElementById("promptUser");
  const promptHost = document.getElementById("promptHost");
  const promptCwd = document.getElementById("promptCwd");
  const promptSymbol = document.getElementById("promptSymbol");
  const connStatus = document.getElementById("connStatus");
  const fxToggle = document.getElementById("fxToggle");
  const jumpLatest = document.getElementById("jumpLatest");
  const app = document.getElementById("app");

  let socket;
  let mode = "terminal";
  let lineQueue = [];
  let flushScheduled = false;
  let history = [];
  let historyIndex = -1;
  let historyDraft = "";
  let currentChoices = [];
  let autoScroll = true;

  const setMode = (value) => {
    mode = value === "story" ? "story" : "terminal";
    app.dataset.mode = mode;
    if (mode === "story") {
      promptRow.classList.add("is-hidden");
    } else {
      promptRow.classList.remove("is-hidden");
      promptInput.focus();
    }
  };

  const setConnection = (online) => {
    connStatus.textContent = online ? "online" : "offline";
    connStatus.classList.toggle("is-online", online);
    connStatus.classList.toggle("is-offline", !online);
    promptInput.disabled = !online;
  };

  const scrollToBottom = () => {
    scrollback.scrollTop = scrollback.scrollHeight;
  };

  const isNearBottom = () => {
    const threshold = 24;
    return scrollback.scrollHeight - scrollback.scrollTop - scrollback.clientHeight <= threshold;
  };

  const updateJumpButton = () => {
    jumpLatest.classList.toggle("is-visible", !autoScroll);
  };

  const capScrollback = () => {
    while (scrollback.children.length > MAX_LINES) {
      scrollback.removeChild(scrollback.firstChild);
    }
  };

  const createLineEl = (text, type, isChoice, choiceIndex) => {
    const el = document.createElement("div");
    el.className = "line";
    const normalized = String(type || "standard").toLowerCase();
    el.classList.add(`line--${normalized}`);
    if (isChoice) {
      el.classList.add("line--choice");
      el.dataset.choiceIndex = String(choiceIndex);
    }
    el.textContent = text ?? "";
    return el;
  };

  const appendLine = (text, type) => {
    lineQueue.push({ text, type });
    scheduleFlush();
  };

  const updateLastLine = (text, type) => {
    const last = scrollback.lastElementChild;
    if (!last) {
      appendLine(text, type);
      return;
    }
    if (type) {
      last.className = "line";
      last.classList.add(`line--${String(type).toLowerCase()}`);
    }
    last.textContent = text ?? "";
    if (autoScroll) {
      scrollToBottom();
    }
  };

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
      flushScheduled = false;
      const fragment = document.createDocumentFragment();
      for (const item of lineQueue) {
        fragment.appendChild(createLineEl(item.text, item.type));
      }
      lineQueue = [];
      scrollback.appendChild(fragment);
      capScrollback();
      if (autoScroll) {
        scrollToBottom();
      }
      updateJumpButton();
    });
  };

  const clearScrollback = () => {
    scrollback.textContent = "";
  };

  const updatePrompt = (payload) => {
    promptUser.textContent = payload.user ? `${payload.user}@` : "";
    promptHost.textContent = payload.host ? payload.host : "";
    promptCwd.textContent = payload.cwd ? `:${payload.cwd}` : "";
    promptSymbol.textContent = payload.symbol || "$";
  };

  const echoInput = (text) => {
    const prompt = `${promptUser.textContent}${promptHost.textContent}${promptCwd.textContent}${promptSymbol.textContent} `;
    appendLine(`${prompt}${text}`, "standard");
  };

  const renderStoryScene = (scene) => {
    currentChoices = [];
    const fragment = document.createDocumentFragment();
    const lines = String(scene.text || "").split(/\r?\n/);
    lines.forEach((line) => {
      fragment.appendChild(createLineEl(line, "standard"));
    });
    if (Array.isArray(scene.choices)) {
      scene.choices.forEach((choice, index) => {
        const label = typeof choice === "string" ? choice : choice.text || "";
        const lineText = `${index + 1}) ${label}`;
        fragment.appendChild(createLineEl(lineText, "choice", true, index + 1));
        currentChoices.push(choice);
      });
    }
    scrollback.appendChild(fragment);
    capScrollback();
    if (autoScroll) {
      scrollToBottom();
    }
    updateJumpButton();
  };

  const handleChoice = (index) => {
    if (!currentChoices.length) return;
    const choiceIndex = Number(index);
    if (!Number.isFinite(choiceIndex)) return;
    if (choiceIndex < 1 || choiceIndex > currentChoices.length) return;
    sendMessage({ t: "choice", index: choiceIndex });
  };

  const sendMessage = (payload) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

  const connect = () => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${window.location.host}/ws`;
    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      setConnection(true);
      appendLine("connected to env0 backend", "system");
    });

    socket.addEventListener("close", () => {
      setConnection(false);
      appendLine("disconnected - retrying shortly", "error");
      setTimeout(connect, 1500);
    });

    socket.addEventListener("error", () => {
      appendLine("connection error", "error");
    });

    socket.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        appendLine("malformed message ignored", "error");
        return;
      }
      if (!msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "mode":
          setMode(msg.value);
          return;
        case "prompt":
          updatePrompt(msg);
          return;
        case "line":
          if (msg.partial) {
            updateLastLine(msg.text, msg.type);
          } else {
            appendLine(msg.text, msg.type);
          }
          return;
        case "lines":
          if (Array.isArray(msg.items)) {
            msg.items.forEach((item) => {
              if (item && item.partial) {
                updateLastLine(item.text, item.type);
              } else if (item) {
                appendLine(item.text, item.type);
              }
            });
          }
          return;
        case "clear":
          clearScrollback();
          return;
        case "err":
          appendLine(msg.message || "error", "error");
          return;
        case "story":
        case "scene":
        case "storyScene":
        case "StoryScene":
          setMode("story");
          renderStoryScene(msg);
          return;
        default:
          return;
      }
    });
  };

  const toggleFx = () => {
    const isOn = app.classList.contains("fx-on");
    if (isOn) {
      app.classList.remove("fx-on");
      app.classList.add("fx-off");
      fxToggle.textContent = "FX: off";
      localStorage.setItem("env0.fx", "off");
    } else {
      app.classList.add("fx-on");
      app.classList.remove("fx-off");
      fxToggle.textContent = "FX: on";
      localStorage.setItem("env0.fx", "on");
    }
  };

  const applyFxPreference = () => {
    const pref = localStorage.getItem("env0.fx");
    if (pref === "off") {
      app.classList.remove("fx-on");
      app.classList.add("fx-off");
      fxToggle.textContent = "FX: off";
    }
  };

  const handleSubmit = () => {
    const text = promptInput.value;
    if (!text.trim()) return;
    echoInput(text);
    history.push(text);
    historyIndex = history.length;
    historyDraft = "";
    promptInput.value = "";
    sendMessage({ t: "input", text });
  };

  promptInput.addEventListener("keydown", (event) => {
    if (mode !== "terminal") return;
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (historyIndex === history.length) {
        historyDraft = promptInput.value;
      }
      historyIndex = Math.max(0, historyIndex - 1);
      promptInput.value = history[historyIndex] || "";
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      if (historyIndex === history.length) {
        promptInput.value = historyDraft;
      } else {
        promptInput.value = history[historyIndex] || "";
      }
      return;
    }
    if (event.key.toLowerCase() === "l" && event.ctrlKey) {
      event.preventDefault();
      clearScrollback();
      sendMessage({ t: "control", action: "clear" });
      return;
    }
    if (event.key.toLowerCase() === "c" && event.ctrlKey) {
      event.preventDefault();
      appendLine("^C", "system");
      sendMessage({ t: "control", action: "interrupt" });
    }
  });

  window.addEventListener("keydown", (event) => {
    if (mode !== "story") return;
    if (event.key >= "1" && event.key <= "9") {
      handleChoice(event.key);
    }
  });

  scrollback.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const idx = target.dataset.choiceIndex;
    if (idx) {
      handleChoice(idx);
    }
  });

  scrollback.addEventListener("scroll", () => {
    autoScroll = isNearBottom();
    updateJumpButton();
  });

  jumpLatest.addEventListener("click", () => {
    autoScroll = true;
    scrollToBottom();
    updateJumpButton();
  });

  fxToggle.addEventListener("click", toggleFx);
  applyFxPreference();
  setMode("terminal");
  setConnection(false);
  connect();
})();

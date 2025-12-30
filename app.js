(() => {
  const MAX_LINES = 1000;
  const TYPING = {
    enabled: true,
    charDelayMs: 14,
    lineDelayMs: 40,
    maxCharsPerLine: 600,
    sceneIntroDelayMs: 260,
    scenePaddingLines: 2
  };
  const scrollback = document.getElementById("scrollback");
  const promptRow = document.getElementById("promptRow");
  const promptInput = document.getElementById("promptInput");
  const storyInputRow = document.getElementById("storyInputRow");
  const storyInput = document.getElementById("storyInput");
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
  let typingQueue = [];
  let typingActive = false;
  let history = [];
  let historyIndex = -1;
  let historyDraft = "";
  let currentChoices = [];
  let autoScroll = true;
  let pendingChoice = false;
  let awaitingAdvance = false;
  let advanceRequested = false;
  let pendingScene = null;
  let advancePromptShown = false;

  const setMode = (value) => {
    mode = value === "story" ? "story" : "terminal";
    app.dataset.mode = mode;
    if (mode === "story") {
      promptRow.classList.add("is-hidden");
      storyInputRow.classList.remove("is-hidden");
      storyInput.focus();
    } else {
      promptRow.classList.remove("is-hidden");
      storyInputRow.classList.add("is-hidden");
      promptInput.focus();
    }
  };

  const setConnection = (online) => {
    connStatus.textContent = online ? "online" : "offline";
    connStatus.classList.toggle("is-online", online);
    connStatus.classList.toggle("is-offline", !online);
    promptInput.disabled = !online;
    storyInput.disabled = !online;
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

  const enqueueTyping = (text, type) =>
    new Promise((resolve) => {
      typingQueue.push({ text, type, resolve });
      runTypingQueue();
    });

  const appendLineInternal = (text, type) => {
    if (TYPING.enabled) {
      return enqueueTyping(text, type);
    }
    lineQueue.push({ text, type });
    scheduleFlush();
    return Promise.resolve();
  };

  const appendLine = (text, type) => appendLineInternal(text, type);

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
    updateJumpButton();
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

  const addBlankLines = async (count) => {
    if (count <= 0) return;
    for (let i = 0; i < count; i += 1) {
      await appendLine(" ", "spacer");
    }
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

  const renderStoryScene = async (scene) => {
    currentChoices = [];
    storyInput.disabled = false;
    storyInput.value = "";
    if (TYPING.enabled && TYPING.sceneIntroDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, TYPING.sceneIntroDelayMs));
    }
    await addBlankLines(TYPING.scenePaddingLines);
    const lines = String(scene.text || "").split(/\r?\n/);
    if (TYPING.enabled) {
      for (const line of lines) {
        await enqueueTyping(line, "standard");
      }
    } else {
      const fragment = document.createDocumentFragment();
      lines.forEach((line) => {
        fragment.appendChild(createLineEl(line, "standard"));
      });
      scrollback.appendChild(fragment);
      capScrollback();
      if (autoScroll) {
        scrollToBottom();
      }
      updateJumpButton();
    }

    await addBlankLines(1);
    if (Array.isArray(scene.choices)) {
      const fragment = document.createDocumentFragment();
      scene.choices.forEach((choice, index) => {
        const label = typeof choice === "string" ? choice : choice.text || "";
        const lineText = `${index + 1}) ${label}`;
        fragment.appendChild(createLineEl(lineText, "choice", true, index + 1));
        currentChoices.push(choice);
      });
      scrollback.appendChild(fragment);
      capScrollback();
      if (autoScroll) {
        scrollToBottom();
      }
      updateJumpButton();
    }
  };

  const handleOutcomeLine = (text) => {
    awaitingAdvance = true;
    advanceRequested = false;
    pendingChoice = false;
    storyInput.disabled = true;
    advancePromptShown = true;
    const trimmed = String(text || "").trim();
    const label = trimmed ? `${trimmed} (press enter)` : "(press enter)";
    addBlankLines(1).then(() => {
      appendLine(label, "system").then(() => {
        if (advanceRequested && pendingScene) {
          advanceRequested = false;
          awaitingAdvance = false;
          clearScrollback();
          renderStoryScene(pendingScene);
          pendingScene = null;
        }
      });
    });
  };

  const handleChoice = (index) => {
    if (!currentChoices.length) return;
    const choiceIndex = Number(index);
    if (!Number.isFinite(choiceIndex)) return;
    if (choiceIndex < 1 || choiceIndex > currentChoices.length) return;
    pendingChoice = true;
    advanceRequested = false;
    advancePromptShown = false;
    pendingScene = null;
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
            return;
          }
          if (mode === "story" && String(msg.type).toLowerCase() === "system") {
            handleOutcomeLine(msg.text || "");
            return;
          }
          if (awaitingAdvance) {
            return;
          }
          appendLine(msg.text, msg.type);
          return;
        case "lines":
          if (Array.isArray(msg.items)) {
            msg.items.forEach((item) => {
              if (item && item.partial) {
                updateLastLine(item.text, item.type);
              } else if (
                item &&
                mode === "story" &&
                String(item.type).toLowerCase() === "system"
              ) {
                handleOutcomeLine(item.text || "");
              } else if (awaitingAdvance) {
                return;
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
          if (awaitingAdvance) {
            pendingScene = msg;
            if (!advancePromptShown) {
              handleOutcomeLine("");
            }
            return;
          }
          if (pendingChoice) {
            pendingScene = msg;
            if (!advancePromptShown) {
              handleOutcomeLine("");
            }
            return;
          }
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

  const handleStorySubmit = () => {
    const raw = storyInput.value.trim();
    if (!raw) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return;
    }
    storyInput.value = "";
    handleChoice(parsed);
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

  storyInput.addEventListener("keydown", (event) => {
    if (mode !== "story") return;
    if (event.key === "Enter" && !awaitingAdvance) {
      event.preventDefault();
      handleStorySubmit();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (mode !== "story") return;
    if (event.key === "Enter" && awaitingAdvance) {
      event.preventDefault();
      if (pendingScene) {
        awaitingAdvance = false;
        pendingChoice = false;
        clearScrollback();
        const nextScene = pendingScene;
        pendingScene = null;
        renderStoryScene(nextScene);
      } else {
        advanceRequested = true;
      }
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

  function runTypingQueue() {
    if (typingActive || !typingQueue.length) return;
    const item = typingQueue.shift();
    if (!item) return;
    typingActive = true;

    const text = item.text ?? "";
    const maxChars = TYPING.maxCharsPerLine;
    const shouldType = TYPING.enabled && text.length <= maxChars;
    const lineEl = createLineEl(shouldType ? "" : text, item.type);
    scrollback.appendChild(lineEl);
    capScrollback();
    if (autoScroll) {
      scrollToBottom();
    }
    updateJumpButton();

    if (!shouldType) {
      typingActive = false;
      item.resolve?.();
      runTypingQueue();
      return;
    }

    let index = 0;
    const step = () => {
      if (!TYPING.enabled) {
        lineEl.textContent = text;
        typingActive = false;
        item.resolve?.();
        runTypingQueue();
        return;
      }
      index += 1;
      lineEl.textContent = text.slice(0, index);
      if (autoScroll) {
        scrollToBottom();
      }
      if (index < text.length) {
        setTimeout(step, TYPING.charDelayMs);
      } else {
        setTimeout(() => {
          typingActive = false;
          item.resolve?.();
          runTypingQueue();
        }, TYPING.lineDelayMs);
      }
    };

    setTimeout(step, TYPING.charDelayMs);
  }
})();

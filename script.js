// fixed script.js
// - AI fallback: /moveAI then fallback to /move?ai=true
// - uses state.hints (not currentHints)
// - doesn't permanently blur sandbox at startup
// - full timer + hints + recommendation + board repaint fixes
// - post-success: coding section inactive (disabled) but no blur

const API = "http://localhost:8080/api/othello";
const boardSize = 8;

// DOM
const boardDiv = document.getElementById("board");
const indicator = document.getElementById("turn-indicator");
const resetButton = document.getElementById("reset");
const startBtn = document.getElementById("start-btn");
const codeEditor = document.getElementById("code-editor");
const runCodeBtn = document.getElementById("run-code-btn");
const clearCodeBtn = document.getElementById("clear-code-btn");
const codeOutput = document.getElementById("code-output");
const codingQuestion = document.getElementById("coding-question");
const testcasesEl = document.getElementById("testcases");
const startScreen = document.getElementById("start-screen");
const mainContainer = document.getElementById("main-container");
const playerNameInput = document.getElementById("player-name");

// Aux DOM elements created by ensureAuxDOM: coding-timer, hints-block, hint-popup, recommendation-feedback

// State
let username = "";
let currentPlayer = 1;
let currentBoard = Array.from({ length: 8 }, () => Array(8).fill(0));
let codingPhaseActive = false;
let codingPhaseLock = false;
let codingTimerSeconds = 60;
let codingTimerInterval = null;
let codingPhaseRunId = 0;
let codingPhaseEndedForever = false;
let hintIndex = 0;
let hints = [];
let aiMoveCount = 0;
let statePoller = null;

// Check if already logged in (from admin.html or session)
// Always show Start button when game.html loads
if (startBtn) startBtn.style.display = "block";

// Load username only if available
username = sessionStorage.getItem("username") || "";


// ---------------- UI helpers ----------------
function ensureAuxDOM() {
    if (!document.getElementById("hint-popup")) {
        const popup = document.createElement("div");
        popup.id = "hint-popup";
        popup.style.position = "fixed";
        popup.style.top = "50%";
        popup.style.left = "50%";
        popup.style.transform = "translate(-50%,-50%)";
        popup.style.background = "rgba(20,20,20,0.95)";
        popup.style.color = "#fff";
        popup.style.padding = "14px 18px";
        popup.style.borderRadius = "10px";
        popup.style.zIndex = "99999";
        popup.style.display = "none";
        popup.style.boxShadow = "0 8px 30px rgba(0,0,0,0.4)";
        popup.style.fontSize = "15px";
        popup.style.textAlign = "center";

        const p = document.createElement("p");
        p.id = "hint-text";
        p.style.margin = "0";
        popup.appendChild(p);
        document.body.appendChild(popup);
    }

    if (!document.getElementById("coding-timer")) {
        const questionDisplay = document.getElementById("question-display") || document.body;
        const timer = document.createElement("div");
        timer.id = "coding-timer";
        timer.style.marginTop = "10px";
        timer.style.fontWeight = "700";
        timer.style.fontSize = "14px";
        timer.style.color = "#ffd54f";
        timer.textContent = "";
        questionDisplay.appendChild(timer);
    }

    if (!document.getElementById("hints-block")) {
        const questionDisplay = document.getElementById("question-display") || document.body;
        const hb = document.createElement("div");
        hb.id = "hints-block";
        hb.style.marginTop = "12px";
        hb.style.whiteSpace = "pre-wrap";
        hb.style.color = "#ffeb3b";
        hb.style.fontSize = "14px";
        questionDisplay.appendChild(hb);
    }

    if (!document.getElementById("recommendation-feedback")) {
        const codeSection = document.getElementById("output-row") || document.getElementById("sandbox-section") || document.body;
        const rd = document.createElement("div");
        rd.id = "recommendation-feedback";
        rd.style.display = "none";
        rd.style.padding = "12px";
        rd.style.marginTop = "10px";
        rd.style.border = "1px solid #ddd";
        rd.style.borderRadius = "8px";
        rd.style.backgroundColor = "#f9f9f9";
        rd.style.fontSize = "14px";
        rd.style.textAlign = "left";
        rd.style.color = "#000";
        rd.style.zIndex = "9999";
        codeSection.appendChild(rd);
    }
}

function showCenterPopup(text, ms = 1400) {
    ensureAuxDOM();
    const popup = document.getElementById("hint-popup");
    const txt = document.getElementById("hint-text");
    if (!popup || !txt) return;
    txt.textContent = text;
    popup.style.opacity = "0";
    popup.style.display = "block";
    setTimeout(() => popup.style.opacity = "1", 10);
    setTimeout(() => {
        popup.style.opacity = "0";
        setTimeout(() => popup.style.display = "none", 250);
    }, ms);
}

// ---------------- Board rendering ----------------
function renderBoard(board, lastMove = null) {
    ensureAuxDOM();

    // create grid if missing
    if (!boardDiv.dataset.initialized || boardDiv.children.length !== 64) {
        boardDiv.dataset.initialized = "true";
        boardDiv.innerHTML = "";

        for (let r = 0; r < boardSize; r++) {
            for (let c = 0; c < boardSize; c++) {
                const cell = document.createElement("div");
                cell.classList.add("cell");
                cell.dataset.row = r;
                cell.dataset.col = c;

                // always rebind
                cell.onclick = () => attemptMove(r, c);
                boardDiv.appendChild(cell);
            }
        }
    }

    // update discs
    const cells = boardDiv.querySelectorAll(".cell");
    for (const cell of cells) {
        const r = Number(cell.dataset.row);
        const c = Number(cell.dataset.col);
        cell.classList.remove("black", "white", "ai-move");
        const v = (board && board[r]) ? board[r][c] : 0;
        if (v === 1) cell.classList.add("black");
        if (v === 2) cell.classList.add("white");

        // trigger repaint fix
        cell.offsetHeight;
    }
    boardDiv.offsetHeight;
    currentBoard = board.map(row => [...row]);
}

// ---------------- State / Polling ----------------
async function fetchState() {
    if (!username) return;
    try {
        const res = await fetch(`${API}/state?username=${encodeURIComponent(username)}`);
        if (!res.ok) {
            console.warn("fetchState not ok", res.status);
            return;
        }
        const state = await res.json();

        // update
        currentPlayer = state.currentPlayer ?? currentPlayer;
        renderBoard(state.board || currentBoard, state.lastMove);
        updateTurnIndicator(currentPlayer);

        // prefer state.hints (server side)
        if (Array.isArray(state.hints) && state.hints.length > 0) {
            hints = state.hints.slice(0, 3);
        } else if (Array.isArray(state.currentHints) && state.currentHints.length > 0) {
            // backward compat
            hints = state.currentHints.slice(0, 3);
        }

        // question/testcases
        if (document.getElementById("coding-question"))
            document.getElementById("coding-question").textContent = state.currentQuestion || "No question available yet.";
        if (testcasesEl)
            testcasesEl.textContent = (state.testcases || []).length
                ? (state.testcases || []).map((t, i) => `Testcase ${i + 1}: ${t}`).join("\n")
                : "No testcases available.";

        // coding mode sync
        if (typeof state.codingMode !== "undefined") {
            if (state.codingMode && !codingPhaseActive) startCodingPhase();
            else if (!state.codingMode && codingPhaseActive && !codingPhaseEndedForever) endCodingPhase();
        }

        // board enabled
        if (typeof state.boardEnabled !== "undefined") {
            enableBoardInteraction(state.boardEnabled);
            updateCodingSectionBlur(state.boardEnabled, state.codingMode);
        }

        updateCodeSubmissionUI(currentPlayer, state);

        // reflect revealed hints using local hintIndex (UI-only)
        const hblock = document.getElementById("hints-block");
        if (hblock && hintIndex > 0 && hints.length > 0) {
            let content = "Hints:\n";
            for (let i = 0; i < Math.min(hintIndex, hints.length); i++) {
                content += `${i + 1}) ${hints[i]}\n`;
            }
            hblock.textContent = content;
        }

    } catch (err) {
        console.error("fetchState error:", err);
    }
}

function startStatePoller() {
    if (statePoller) return;
    statePoller = setInterval(fetchState, 700);
}

function stopStatePoller() {
    if (statePoller) clearInterval(statePoller);
    statePoller = null;
}

// ---------------- Moves ----------------
function attemptMove(r, c) {
    if (codingPhaseActive) {
        showCenterPopup("Board locked during coding phase", 900);
        return;
    }
    makeMove(r, c);
}

async function makeMove(row, col) {
    if (!username) return;

    try {
        const userRes = await fetch(`${API}/move?username=${encodeURIComponent(username)}&row=${row}&col=${col}`, { method: "POST" });
        if (!userRes.ok) {
            console.warn("user move failed", userRes.status);
            return;
        }

        const userState = await userRes.json();
        renderBoard(userState.board || currentBoard, userState.lastMove);
        updateTurnIndicator(userState.currentPlayer);
        logMove(row, col);

        // small delay then AI
        await new Promise(r => setTimeout(r, 450));

        // AI: try moveAI endpoint first, fallback to move?ai=true
        let aiState = null;
        try {
            const aiRes = await fetch(`${API}/moveAI?username=${encodeURIComponent(username)}`, { method: "POST" });
            if (aiRes.ok) aiState = await aiRes.json();
            else {
                const aiRes2 = await fetch(`${API}/move?username=${encodeURIComponent(username)}&ai=true`, { method: "POST" });
                if (aiRes2.ok) aiState = await aiRes2.json();
                else console.warn("AI endpoints failed", aiRes.status, aiRes2.status);
            }
        } catch (e) {
            try {
                const aiRes2 = await fetch(`${API}/move?username=${encodeURIComponent(username)}&ai=true`, { method: "POST" });
                if (aiRes2.ok) aiState = await aiRes2.json();
            } catch (ee) {
                console.error("AI call both attempts failed:", e, ee);
            }
        }

        if (aiState) {
            if (aiState.lastMove) {
                highlightAIMove(aiState.lastMove[0], aiState.lastMove[1]);
                await new Promise(r => setTimeout(r, 400));
            }
            renderBoard(aiState.board || currentBoard, aiState.lastMove);
            updateTurnIndicator(aiState.currentPlayer);
        } else {
            // If AI didn't return state, request fresh state from server
            await fetchState();
        }

        aiMoveCount++;
        if (aiMoveCount >= 2 && hintIndex < 3 && hintIndex < hints.length) {
            revealNextHint();
            const hintText = hints[hintIndex - 1] || "";
            if (hintText) showCenterPopup(`💡 ${hintText}`, 1600);
        }

    } catch (err) {
        console.error("makeMove error:", err);
    }
}

function highlightAIMove(r, c) {
    const sel = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
    if (sel) {
        sel.classList.add("ai-move");
        setTimeout(() => sel.classList.remove("ai-move"), 800);
    }
}

// ---------------- Hints ----------------
function revealNextHint() {
    const hblock = document.getElementById("hints-block");
    if (!hblock || !hints || hints.length === 0) return;
    if (hintIndex >= hints.length || hintIndex >= 3) return;

    hintIndex++;
    let content = "Hints:\n";
    for (let i = 0; i < Math.min(hintIndex, hints.length); i++) {
        content += `${i + 1}) ${hints[i]}\n`;
    }
    hblock.textContent = content;
}

// ---------------- Coding phase UI ----------------
function enableBoardInteraction(enable) {
    if (enable) {
        codingPhaseActive = false;
        boardDiv.style.pointerEvents = "auto";
        boardDiv.style.filter = "none";
        boardDiv.style.opacity = "1";
    } else {
        codingPhaseActive = true;
        boardDiv.style.pointerEvents = "none";
        boardDiv.style.filter = "blur(2px)";
        boardDiv.style.opacity = "0.6";
    }
}

function updateCodeSubmissionUI(player, state = null) {
    const enabled = codingPhaseActive || (state && state.runButtonEnabled);
    if (enabled) {
        runCodeBtn.disabled = !(player === 1);
        codeEditor.disabled = false;
    } else {
        runCodeBtn.disabled = true;
        codeEditor.disabled = codingPhaseEndedForever; // Disable editor only post-success
    }
}

function formatTime(sec) {
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function startCodingPhase() {
    if (codingPhaseEndedForever) {
        enableBoardInteraction(true);
        return;
    }
    if (codingPhaseActive || codingPhaseLock) return;

    codingPhaseLock = true;
    codingPhaseActive = true;
    codingPhaseRunId++;
    const runId = codingPhaseRunId;

    showCenterPopup("📝 Coding phase started — you have 1 minute to code", 1400);
    updateCodeSubmissionUI(currentPlayer);
    enableBoardInteraction(false);
    ensureAuxDOM();

    const timerEl = document.getElementById("coding-timer");
    const total = codingTimerSeconds;
    const endTime = Date.now() + total * 1000;

    if (codingTimerInterval) {
        clearInterval(codingTimerInterval);
        codingTimerInterval = null;
    }

    const computeRemaining = () => Math.max(0, Math.ceil((endTime - Date.now()) / 1000));

    if (timerEl) timerEl.textContent = `Time left: ${formatTime(computeRemaining())}`;

    codingTimerInterval = setInterval(() => {
        if (runId !== codingPhaseRunId) {
            clearInterval(codingTimerInterval);
            codingTimerInterval = null;
            return;
        }

        if (codingPhaseEndedForever) {
            clearInterval(codingTimerInterval);
            codingTimerInterval = null;
            endCodingPhase();
            return;
        }

        const remaining = computeRemaining();
        if (timerEl) timerEl.textContent = `Time left: ${formatTime(remaining)}`;
        if (remaining <= 0) {
            clearInterval(codingTimerInterval);
            codingTimerInterval = null;
            endCodingPhase();
        }

    }, 250);

    setTimeout(() => { codingPhaseLock = false; }, 1200);
}

// NEW: Blurs coding section when board is active (but no blur post-success)
function updateCodingSectionBlur(boardEnabled, codingMode) {
    const sandbox = document.getElementById("sandbox-section");

    // Post-success: always unblur coding area
    if (codingPhaseEndedForever) {
        sandbox.style.filter = "none";
        sandbox.style.opacity = "1";
        return;
    }

    // If coding mode → unblur coding area
    if (codingMode) {
        sandbox.style.filter = "none";
        sandbox.style.opacity = "1";
        return;
    }

    // If playing → blur coding section
    if (boardEnabled) {
        sandbox.style.filter = "blur(4px)";
        sandbox.style.opacity = "0.7";
    } else {
        // If board is locked (coding phase) → unblur coding section
        sandbox.style.filter = "none";
        sandbox.style.opacity = "1";
    }
}

function endCodingPhase() {
    ensureAuxDOM();
    const timerEl = document.getElementById("coding-timer");

    if (codingPhaseEndedForever) {
        if (codingTimerInterval) {
            clearInterval(codingTimerInterval);
            codingTimerInterval = null;
        }
        codingPhaseActive = false;
        if (codeEditor) codeEditor.disabled = true;
        if (runCodeBtn) runCodeBtn.disabled = true;
        if (timerEl) timerEl.textContent = `Time left: ${formatTime(0)}`;
        stopHints();
        enableBoardInteraction(true);

        // Ensure no blur post-success
        const sandbox = document.getElementById("sandbox-section");
        if (sandbox) {
            sandbox.style.filter = "none";
            sandbox.style.opacity = "1";
        }
        return;
    }

    if (codingTimerInterval) {
        clearInterval(codingTimerInterval);
        codingTimerInterval = null;
    }

    codingPhaseActive = false;
    if (timerEl) timerEl.textContent = `Time left: ${formatTime(0)}`;
    enableBoardInteraction(true);
    updateCodeSubmissionUI(currentPlayer);
    showCenterPopup("⏰ Time's up — return to the game", 1200);
}

function stopHints() {
    const hblock = document.getElementById("hints-block");
    if (hblock) hblock.textContent = "";
    hintIndex = Number.MAX_SAFE_INTEGER;
}

// ---------------- Run code / recommendations ----------------
async function runCode() {
    if (!codingPhaseActive) {
        codeOutput.textContent = "Code submission allowed only during the 1-minute coding phase.";
        return;
    }
    if (currentPlayer !== 1) {
        codeOutput.textContent = "Only Black Player can submit code!";
        return;
    }
    if (!username) {
        alert("Not logged in");
        return;
    }

    const code = codeEditor.value.trim();
    if (!code) {
        codeOutput.textContent = "Please enter code.";
        return;
    }

    codeOutput.textContent = "Running...";
    runCodeBtn.disabled = true;

    try {
        const res = await fetch(`${API}/submitCode?username=${encodeURIComponent(username)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code })
        });

        const result = await res.json();
        let out = "";

        if (result.compile_output) out += "Compile Output:\n" + result.compile_output + "\n\n";
        if (result.stderr) out += "Error:\n" + result.stderr + "\n\n";
        if (result.stdout) out += "Output:\n" + result.stdout;
        if (!result.stdout && !result.stderr) out += "No output produced.";

        codeOutput.textContent = out;

        if (result.success) {
            codingPhaseEndedForever = true;
            stopHints();
            endCodingPhase();
            boardDiv.dataset.initialized = "false";
            boardDiv.innerHTML = "";
            await fetchState();
            showCenterPopup("✅ Code executed successfully — coding phases disabled.", 1500);

            if (result.feedback && (result.leetcodeHtml || result.hackerRankHtml || result.youtubeHtml || result.pdfHtml)) {
                ensureAuxDOM();
                const feedbackDiv = document.getElementById("recommendation-feedback");
                if (feedbackDiv) {
                    const duration = parseFloat(result.solvingDurationMin || 0);
                    let linksHtml = "";

                    if (duration <= 1.0) {
                        const leet = result.leetcodeHtml || `<a href="${result.leetcodeLink || ''}" target="_blank">LeetCode</a>`;
                        const hack = result.hackerRankHtml || `<a href="${result.hackerRankLink || ''}" target="_blank">HackerRank</a>`;
                        linksHtml = `<div style="margin-bottom:8px;">${leet}</div><div>${hack}</div>`;
                        feedbackDiv.style.borderColor = "#4caf50";
                        feedbackDiv.style.backgroundColor = "#e8f5e8";
                    } else {
                        const yt = result.youtubeHtml || `<a href="${result.youtubeLink || ''}" target="_blank">YouTube</a>`;
                        const pdf = result.pdfHtml || `<a href="${result.pdfLink || ''}" target="_blank">PDF</a>`;
                        linksHtml = `<div style="margin-bottom:8px;">${yt}</div><div>${pdf}</div>`;
                        feedbackDiv.style.borderColor = "#ff9800";
                        feedbackDiv.style.backgroundColor = "#fff3e0";
                    }

                    feedbackDiv.innerHTML = `
                        <p><strong>${result.feedback}</strong></p>
                        <p>${result.recommendationText || 'Recommendations:'}</p>
                        <div style="margin:10px 0;">${linksHtml}</div>
                        <p style="margin-top:10px;font-size:12px;color:#666;">Solving time: ${result.solvingDurationMin} minutes</p>
                        <button id="rec-close-btn" style="margin-top:8px;padding:6px 10px;border:0;border-radius:6px;cursor:pointer;">Close</button>
                    `;
                    feedbackDiv.style.display = "block";
                    document.getElementById("rec-close-btn").addEventListener("click", () => feedbackDiv.style.display = "none");
                }
            }
        } else {
            runCodeBtn.disabled = true;
        }

    } catch (err) {
        codeOutput.textContent = "Error: " + err.message;
    } finally {
        if (!codingPhaseEndedForever) runCodeBtn.disabled = false;
    }
}

// ---------------- Utilities ----------------
function logMove(r, c) {
    const moveLog = document.getElementById("move-log");
    if (!moveLog) return;
    const li = document.createElement("li");
    li.textContent = `(${r + 1}, ${c + 1})`;
    moveLog.appendChild(li);
}

function clearMoveLog() {
    const ml = document.getElementById("move-log");
    if (ml) ml.innerHTML = "";
}

async function markCodeStart() {
    if (!username) return;
    try {
        await fetch(`${API}/markCodeStart?username=${encodeURIComponent(username)}`, { method: "POST" });
    } catch (err) {
        console.error("markCodeStart", err);
    }
}

// ---------------- Login / Start / Reset ----------------
startBtn.addEventListener("click", async () => {
    const playerName = playerNameInput.value.trim();
    if (!playerName) return alert("Enter name");

    username = sessionStorage.getItem("username") || username;

    try {
        await fetch(`${API}/start?username=${encodeURIComponent(username)}&playerName=${encodeURIComponent(playerName)}`, { method: "POST" });
        startScreen.style.display = "none";
        mainContainer.style.display = "flex";

        // initial load + polling
        await fetchState();
        startStatePoller();

    } catch (err) {
        console.error("startGame:", err);
    }
});

resetButton.addEventListener("click", async () => {
    if (!username) return;
    try {
        await fetch(`${API}/reset?username=${encodeURIComponent(username)}`, { method: "POST" });
        await fetchState();
        clearMoveLog();
        aiMoveCount = 0;
        hintIndex = 0;
        hints = [];

        const hblock = document.getElementById("hints-block");
        if (hblock) hblock.textContent = "";

    } catch (err) {
        console.error("reset error:", err);
    }
});

// run/clear handlers
runCodeBtn.addEventListener("click", runCode);
clearCodeBtn.addEventListener("click", () => {
    if (codeEditor) codeEditor.value = "";
    if (codeOutput) codeOutput.textContent = "";
});

// markCodeStart on focus
if (codeEditor) codeEditor.addEventListener("focus", () => markCodeStart());

// ensure aux DOM exists
ensureAuxDOM();

// DON'T permanently blur sandbox at startup
if (document.getElementById("sandbox-section")) {
    // keep it visible only after start; initial startup main-container is hidden in HTML already
}

// initial global question load
(async () => {
    try {
        const q = await fetch(`${API}/codingQuestion`);
        if (q.ok) {
            const j = await q.json();
            if (j.question && document.getElementById("coding-question"))
                document.getElementById("coding-question").textContent = j.question;
            if (j.testCases && j.testCases.length && testcasesEl)
                testcasesEl.textContent = j.testCases.join("\n");
            if (j.hints && j.hints.length)
                hints = j.hints.slice(0, 3);
        }
    } catch (err) {
        console.warn("Initial question failed:", err);
    }
})();

// small helper to update UI turn indicator
function updateTurnIndicator(cp) {
    if (!indicator) return;
    indicator.textContent = `Current Turn: ${cp === 1 ? "Black" : "White"}`;
}

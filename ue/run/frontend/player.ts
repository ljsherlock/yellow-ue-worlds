// Yellow UE Worlds custom player: drives panel (engine -> browser) and camera
// controls (browser -> engine via emitUIInteraction -> StreamBridge).

import { Config, PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.7';

interface Creature {
    id: string;
    type: string;
    state: string;
    thirst: number;
    fatigue: number;
    speed: number;
    arrived: boolean;
    atWater: boolean;
}

// ── Demo / debug UI toggles ─────────────────────────────────────────────────
// Flip a value to true to bring an overlay back. These are bundled into
// player.js, so changing them requires a frontend redeploy (deploy_frontend.sh
// on the VM) + a browser refresh.
const DEBUG_UI = {
    // Right-hand per-elephant drives panel (thirst / fatigue / state).
    showDrivesPanel: false,
    // Manual camera control bar. The browser->engine input path is currently
    // broken (emitUIInteraction never reaches StreamBridge), so the buttons do
    // nothing; the RC-driven auto-cam follows the herd instead. Re-enable once
    // the input path is fixed.
    showCameraButtons: false
};

type CameraMode = 'free' | 'follow' | 'overview';

let activeCameraMode: CameraMode = 'overview';
let activeFollowId = 'a01';
let pixelStreamingRef: PixelStreaming | null = null;

document.body.onload = function () {
    const config = new Config({
        initialSettings: {
            AutoPlayVideo: true,
            AutoConnect: true,
            StartVideoMuted: true,
            WaitForStreamer: true
        }
    });

    const pixelStreaming = new PixelStreaming(config, {
        videoElementParent: document.getElementById('videoParentElement') as HTMLElement
    });
    pixelStreamingRef = pixelStreaming;

    pixelStreaming.addEventListener('playStreamRejected', () => {
        const clickToPlay = document.getElementById('clickToPlayElement') as HTMLElement;
        clickToPlay.className = 'visible';
        clickToPlay.onclick = () => {
            pixelStreaming.play();
            clickToPlay.className = '';
            clickToPlay.onclick = null;
        };
    });

    const panel = document.getElementById('drivesPanel') as HTMLElement;
    const summary = document.getElementById('hySummary') as HTMLElement;
    const rows = document.getElementById('hyRows') as HTMLElement;
    const cameraBar = document.getElementById('cameraBar') as HTMLElement;

    // Apply demo/debug visibility toggles. Hidden panels stay in the DOM (and
    // still receive their data) so flipping DEBUG_UI back on needs no other code.
    if (!DEBUG_UI.showDrivesPanel) { panel.classList.add('hy-hidden'); }
    if (!DEBUG_UI.showCameraButtons) { cameraBar.classList.add('hy-hidden'); }

    pixelStreaming.addResponseEventListener('hyDrives', (response: string) => {
        let data: { t?: string; creatures?: Creature[] };
        try {
            data = JSON.parse(response);
        } catch {
            return;
        }
        if (!data || data.t !== 'creatures' || !Array.isArray(data.creatures)) {
            return;
        }
        if (!bootCamAsserted && data.creatures.length > 0) {
            bootCamAsserted = true;
            sendHyCmd(pixelStreaming, 'FocusHerdOverview');
        }
        latestCreatureCount = data.creatures.length;
        render(panel, summary, rows, cameraBar, data.creatures);
    });

    setupCameraControls(pixelStreaming, cameraBar);
    setupScenePrompts();
};

// ── Natural-language scene control ──────────────────────────────────────────
// Browser -> /api/brain/prompt (domain-relative; Caddy routes it to the brain
// service). This path is independent of Pixel Streaming / emitUIInteraction:
// the first prompt builds a fresh scene (mode:'build' clears the herd first),
// later prompts mutate it (mode:'modify'). No engine/StreamBridge involvement.

const BRAIN_ENDPOINT = '/api/brain/prompt';
type PromptMode = 'build' | 'modify';

let sceneStarted = false;
let lastStartPrompt = '';
let promptBusy = false;
// Live herd size from the most recent hyDrives push (engine -> data channel).
// Drives the build progress UI: during a build the count resets to 0 (the
// backend clears first) then climbs as elephants spawn, so we can show real
// "summoning the herd… N gathering" progress without any backend change.
let latestCreatureCount = 0;

interface BrainResponse {
    ok?: boolean;
    error?: string;
    reasoning?: string;
    steps?: { ok?: boolean; error?: string }[];
}

// Safety cap so a hung backend can't spin the progress bar forever. A big
// build (clear + ~50 sequential spawns + trailing calls) is the slowest case
// and still finishes well inside this; if we hit it, something is wrong and we
// surface a timeout rather than wait indefinitely.
const PROMPT_TIMEOUT_MS = 180000;

async function postPrompt(prompt: string, mode: PromptMode): Promise<BrainResponse> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), PROMPT_TIMEOUT_MS);
    let res: Response;
    try {
        res = await fetch(BRAIN_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt, mode }),
            signal: ctrl.signal
        });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            return { ok: false, error: `timed out after ${Math.round(PROMPT_TIMEOUT_MS / 1000)}s` };
        }
        throw e;
    } finally {
        window.clearTimeout(timer);
    }
    let body: BrainResponse = {};
    try {
        body = (await res.json()) as BrainResponse;
    } catch {
        body = {};
    }
    if (!res.ok && body.ok === undefined) {
        body.ok = false;
        body.error = body.error ?? `server returned ${res.status}`;
    }
    return body;
}

function setStatus(el: HTMLElement, text: string, kind: '' | 'busy' | 'ok' | 'err'): void {
    el.textContent = text;
    el.className = kind ? `hy-status ${kind}` : 'hy-status';
}

interface ProgressHandle {
    stop: (text: string, kind: '' | 'ok' | 'err') => void;
}

// Live activity feedback for an in-flight prompt — NOT a completion signal.
// Completion is decided solely by the backend HTTP response (handlePrompt runs
// the whole plan before replying), so this only animates the bar and reflects
// the herd count climbing in over the data channel while we wait. The bar is
// indeterminate: we can't know the planned total until the request returns.
function startProgress(statusEl: HTMLElement, barEl: HTMLElement, mode: PromptMode): ProgressHandle {
    const t0 = Date.now();
    barEl.classList.add('active');
    let phase: 'planning' | 'summoning' | 'updating' = mode === 'build' ? 'planning' : 'updating';
    // For the status text only: switch "Planning…" -> "Summoning…" once the
    // clear has dropped the old herd and the first new elephants appear.
    let lowSeen = mode !== 'build';
    let stopped = false;

    const tick = () => {
        const secs = Math.floor((Date.now() - t0) / 1000);
        if (mode !== 'build') {
            setStatus(statusEl, `Updating… ${secs}s`, 'busy');
            return;
        }
        const n = latestCreatureCount;
        if (n === 0) { lowSeen = true; }
        if (!lowSeen && secs >= 2) { lowSeen = true; }  // fallback if we miss the 0 frame (~2 Hz feed)
        if (phase === 'planning' && lowSeen && n > 0) { phase = 'summoning'; }
        if (phase === 'planning') {
            setStatus(statusEl, `Planning the scene… ${secs}s`, 'busy');
        } else {
            const hint = secs >= 20 ? ' · finishing up…' : '';
            setStatus(statusEl, `Summoning the herd… ${n} gathering · ${secs}s${hint}`, 'busy');
        }
    };

    tick();
    const id = window.setInterval(tick, 300);

    return {
        stop: (text, kind) => {
            if (stopped) { return; }
            stopped = true;
            window.clearInterval(id);
            barEl.classList.remove('active');
            setStatus(statusEl, text, kind);
        }
    };
}

function setupScenePrompts(): void {
    const scenePrompt = document.getElementById('scenePrompt') as HTMLElement;
    const updatePrompt = document.getElementById('updatePrompt') as HTMLElement;
    const startInput = document.getElementById('startInput') as HTMLTextAreaElement;
    const startSend = document.getElementById('startSend') as HTMLButtonElement;
    const startStatus = document.getElementById('startStatus') as HTMLElement;
    const updateInput = document.getElementById('updateInput') as HTMLInputElement;
    const updateSend = document.getElementById('updateSend') as HTMLButtonElement;
    const updateStatus = document.getElementById('updateStatus') as HTMLElement;
    const restartBtn = document.getElementById('restartBtn') as HTMLButtonElement;
    const startProgressEl = document.getElementById('startProgress') as HTMLElement;
    const updateProgressEl = document.getElementById('updateProgress') as HTMLElement;

    const setBusy = (busy: boolean) => {
        promptBusy = busy;
        startSend.disabled = busy;
        startInput.disabled = busy;
        updateSend.disabled = busy;
        updateInput.disabled = busy;
        restartBtn.disabled = busy;
    };

    const showStart = (prefill: string) => {
        sceneStarted = false;
        startInput.value = prefill;
        updatePrompt.classList.add('hy-hidden');
        scenePrompt.classList.remove('hy-hidden');
        setStatus(updateStatus, '', '');
        startInput.focus();
    };

    const showUpdate = () => {
        sceneStarted = true;
        scenePrompt.classList.add('hy-hidden');
        updatePrompt.classList.remove('hy-hidden');
        updateInput.value = '';
        updateInput.focus();
    };

    const submitStart = async () => {
        const prompt = startInput.value.trim();
        if (!prompt || promptBusy) {
            return;
        }
        setBusy(true);
        const prog = startProgress(startStatus, startProgressEl, 'build');
        // Completion is driven by the backend response, NOT a guess at the herd
        // count. handlePrompt() runs the whole plan (ClearCreatures -> every
        // SpawnCreature -> drives/leader/time/camera) and only then responds, so
        // the HTTP resolve is the one signal that can't fire before the scene is
        // actually built. The progress bar / "N gathering" text is just live
        // activity feedback while we wait; it no longer decides when we're done.
        try {
            const r = await postPrompt(prompt, 'build');
            if (r.ok) {
                prog.stop('', '');
                lastStartPrompt = prompt;
                showUpdate();
                const n = latestCreatureCount;
                setStatus(updateStatus,
                    n > 0 ? `Scene ready — ${n} elephants. Tell me what to change.` : 'Scene created. Tell me what to change.',
                    'ok');
            } else {
                prog.stop(r.error ? `Couldn't build: ${r.error}` : "Couldn't build the scene.", 'err');
            }
        } catch (e) {
            prog.stop(`Network error: ${e instanceof Error ? e.message : e}`, 'err');
        } finally {
            setBusy(false);
        }
    };

    const submitUpdate = async () => {
        const prompt = updateInput.value.trim();
        if (!prompt || promptBusy) {
            return;
        }
        setBusy(true);
        const prog = startProgress(updateStatus, updateProgressEl, 'modify');
        try {
            const r = await postPrompt(prompt, 'modify');
            if (r.ok) {
                updateInput.value = '';
                prog.stop('Done.', 'ok');
            } else {
                prog.stop(r.error ? `Failed: ${r.error}` : 'That change failed.', 'err');
            }
        } catch (e) {
            prog.stop(`Network error: ${e instanceof Error ? e.message : e}`, 'err');
        } finally {
            setBusy(false);
        }
    };

    startSend.addEventListener('click', submitStart);
    updateSend.addEventListener('click', submitUpdate);
    restartBtn.addEventListener('click', () => {
        if (promptBusy) {
            return;
        }
        showStart(lastStartPrompt);
    });

    // Keep typing out of the stream. Pixel Streaming's KeyboardController binds
    // keydown/keyup/keypress on `document` (bubble phase), so a keystroke only
    // reaches the engine by bubbling up from the focused element. While a prompt
    // field is focused we stop that bubble, so WASD (and every other key) edits
    // the text box instead of driving the fly-cam. stopPropagation (not
    // stopImmediatePropagation) leaves the field's own typing + our Enter
    // handler below intact, and never calls preventDefault, so characters still
    // appear. Focus elsewhere -> these never fire, so camera keys still work.
    const keepKeysLocal = (el: HTMLElement) => {
        for (const type of ['keydown', 'keyup', 'keypress'] as const) {
            el.addEventListener(type, (e) => e.stopPropagation());
        }
    };
    keepKeysLocal(startInput);
    keepKeysLocal(updateInput);

    // Enter submits; Shift+Enter in the textarea inserts a newline.
    startInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submitStart();
        }
    });
    updateInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void submitUpdate();
        }
    });
}

// Re-assert the herd-overview cam once, the moment the data channel is proven
// live (first drives message received). The demo also sets it engine-side at
// boot, but this browser may have connected after that, so we re-affirm it here
// where emitUIInteraction is guaranteed to reach the engine.
let bootCamAsserted = false;

function sendHyCmd(
    pixelStreaming: PixelStreaming,
    hyCmd: string,
    extra?: Record<string, string>
): void {
    const payload = JSON.stringify({ hyCmd, ...extra });
    pixelStreaming.emitUIInteraction(payload);
}

function setupCameraControls(pixelStreaming: PixelStreaming, cameraBar: HTMLElement): void {
    const btnFreeFly = document.getElementById('btnFreeFly') as HTMLButtonElement;
    const btnFollowLead = document.getElementById('btnFollowLead') as HTMLButtonElement;
    const btnOverview = document.getElementById('btnOverview') as HTMLButtonElement;
    const followSelect = document.getElementById('followSelect') as HTMLSelectElement;

    const setActive = (mode: CameraMode, followId?: string) => {
        activeCameraMode = mode;
        if (followId) {
            activeFollowId = followId;
        }
        for (const btn of [btnFreeFly, btnFollowLead, btnOverview]) {
            btn.classList.toggle('active', btn.dataset['mode'] === mode &&
                (mode !== 'follow' || btn.dataset['id'] === activeFollowId));
        }
        cameraBar.classList.add('ready');
    };

    btnFreeFly.addEventListener('click', () => {
        sendHyCmd(pixelStreaming, 'StopFocus');
        setActive('free');
    });

    btnFollowLead.addEventListener('click', () => {
        const id = btnFollowLead.dataset['id'] || 'a01';
        sendHyCmd(pixelStreaming, 'FocusCamera', { id });
        setActive('follow', id);
        followSelect.value = '';
    });

    btnOverview.addEventListener('click', () => {
        sendHyCmd(pixelStreaming, 'FocusHerdOverview');
        setActive('overview');
        followSelect.value = '';
    });

    followSelect.addEventListener('change', () => {
        const id = followSelect.value;
        if (!id) {
            return;
        }
        sendHyCmd(pixelStreaming, 'FocusCamera', { id });
        setActive('follow', id);
    });
}

function pct(v: number): number {
    return Math.max(0, Math.min(100, Math.round((v || 0) * 100)));
}

function render(
    panel: HTMLElement,
    summary: HTMLElement,
    rows: HTMLElement,
    cameraBar: HTMLElement,
    creatures: Creature[]
): void {
    panel.classList.add('ready');
    cameraBar.classList.add('ready');

    const drinking = creatures.filter((c) => c.state === 'drink' || c.atWater).length;
    const moving = creatures.filter((c) => c.speed > 1).length;
    const avgThirst =
        creatures.length > 0
            ? creatures.reduce((s, c) => s + (c.thirst || 0), 0) / creatures.length
            : 0;
    summary.textContent =
        `${creatures.length} elephants · ${drinking} drinking · ${moving} on the move · thirst ${pct(avgThirst)}%`;

    const sorted = [...creatures].sort((a, b) => a.id.localeCompare(b.id));
    updateFollowSelect(sorted);

    rows.innerHTML = sorted
        .map((c) => {
            const stateCls = (c.state || 'idle').toLowerCase();
            return `
            <div class="hy-row" data-id="${escapeHtml(c.id)}" title="Follow ${escapeHtml(c.id)}">
              <div class="hy-rtop">
                <span class="hy-id">${escapeHtml(c.id)}</span>
                <span class="hy-state ${stateCls}">${escapeHtml(c.state || 'idle')}</span>
              </div>
              <div class="hy-bar"><span style="width:${pct(c.thirst)}%;background:var(--hy-thirst)"></span></div>
              <div class="hy-bar"><span style="width:${pct(c.fatigue)}%;background:var(--hy-fatigue)"></span></div>
              <div class="hy-barlabels"><span>thirst ${pct(c.thirst)}%</span><span>fatigue ${pct(c.fatigue)}%</span></div>
            </div>`;
        })
        .join('');

    for (const row of rows.querySelectorAll<HTMLElement>('.hy-row')) {
        row.addEventListener('click', () => {
            const id = row.dataset['id'];
            if (!id || !pixelStreamingRef) {
                return;
            }
            sendHyCmd(pixelStreamingRef, 'FocusCamera', { id });
            activeCameraMode = 'follow';
            activeFollowId = id;
            const followSelect = document.getElementById('followSelect') as HTMLSelectElement;
            if (followSelect) {
                followSelect.value = id;
            }
            for (const btn of document.querySelectorAll<HTMLButtonElement>('.hy-btn')) {
                btn.classList.toggle('active', btn.dataset['mode'] === 'follow' && btn.dataset['id'] === id);
            }
        });
    }
}

function updateFollowSelect(creatures: Creature[]): void {
    const followSelect = document.getElementById('followSelect') as HTMLSelectElement;
    if (!followSelect || creatures.length === 0) {
        return;
    }
    // Rebuild only when the option set is out of sync with the herd (e.g. the
    // first drives push arrived before any elephant spawned, so the list was
    // empty). Don't lock with a one-shot flag — that's what left it permanently
    // empty. Preserve the current selection across rebuilds.
    const existing = followSelect.querySelectorAll('option[value]:not([value=""])').length;
    if (existing === creatures.length) {
        return;
    }
    const current = followSelect.value;
    const opts = creatures.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)}</option>`).join('');
    followSelect.innerHTML = `<option value="">Follow…</option>${opts}`;
    followSelect.value = current;
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (ch) => {
        switch (ch) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}

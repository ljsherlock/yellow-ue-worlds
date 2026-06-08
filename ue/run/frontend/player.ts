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

type CameraMode = 'free' | 'follow' | 'overview';

let activeCameraMode: CameraMode = 'follow';
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
        render(panel, summary, rows, cameraBar, data.creatures);
    });

    setupCameraControls(pixelStreaming, cameraBar);
    // Demo boots with follow-cam on a01 — mirror that in the UI.
    sendHyCmd(pixelStreaming, 'FocusCamera', { id: 'a01' });
};

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
    if (!followSelect || followSelect.dataset['ready'] === '1') {
        return;
    }
    const opts = creatures.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)}</option>`).join('');
    followSelect.innerHTML = `<option value="">Follow…</option>${opts}`;
    followSelect.dataset['ready'] = '1';
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

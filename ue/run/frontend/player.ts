// Copyright Epic Games, Inc. All Rights Reserved. (derived from the `uiless` sample)
//
// Yellow UE Worlds custom player: the core Pixel Streaming library only (so no
// default UI), plus a small top-right "drives" panel. The engine pushes live
// creature state every ~0.5s via UPixelStreaming2Input::SendPixelStreaming2Response
// (see AStreamBridge); we receive it through addResponseEventListener and render.

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

    // Browser autoplay guard (same as the uiless sample).
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

    // The engine sends a JSON descriptor; every response listener receives it.
    pixelStreaming.addResponseEventListener('hyDrives', (response: string) => {
        let data: { t?: string; creatures?: Creature[] };
        try {
            data = JSON.parse(response);
        } catch {
            return; // not our message
        }
        if (!data || data.t !== 'creatures' || !Array.isArray(data.creatures)) {
            return;
        }
        render(panel, summary, rows, data.creatures);
    });
};

function pct(v: number): number {
    return Math.max(0, Math.min(100, Math.round((v || 0) * 100)));
}

function render(panel: HTMLElement, summary: HTMLElement, rows: HTMLElement, creatures: Creature[]): void {
    panel.classList.add('ready');

    const drinking = creatures.filter((c) => c.state === 'drink' || c.atWater).length;
    const moving = creatures.filter((c) => c.speed > 1).length;
    const avgThirst =
        creatures.length > 0
            ? creatures.reduce((s, c) => s + (c.thirst || 0), 0) / creatures.length
            : 0;
    summary.textContent =
        `${creatures.length} elephants · ${drinking} drinking · ${moving} on the move · thirst ${pct(avgThirst)}%`;

    // Stable order by id so rows don't jump around frame to frame.
    const sorted = [...creatures].sort((a, b) => a.id.localeCompare(b.id));

    rows.innerHTML = sorted
        .map((c) => {
            const stateCls = (c.state || 'idle').toLowerCase();
            return `
            <div class="hy-row">
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

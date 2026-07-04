import { escapeHtml } from "../html-utils.js";

export function introCardHtml(params: { start: number; duration: number; featureName: string; narrative: string }): string {
  const { start, duration, featureName, narrative } = params;
  return `
      <div class="clip" data-start="${start}" data-duration="${duration}" data-track-index="0"
           style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
                  justify-content:center; background:#0f172a; color:#fff; text-align:center; padding:80px;">
        <div style="font-size:64px; font-weight:700; margin-bottom:24px;">${escapeHtml(featureName)}</div>
        <div style="font-size:28px; color:#cbd5e1; max-width:1200px;">${escapeHtml(narrative)}</div>
      </div>`;
}

import { escapeHtml } from "../html-utils.js";

export function outroCardHtml(params: { start: number; duration: number; prTitle: string; prUrl: string }): string {
  const { start, duration, prTitle, prUrl } = params;
  return `
      <div class="clip" data-start="${start}" data-duration="${duration}" data-track-index="0"
           style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
                  justify-content:center; background:#0f172a; color:#fff; text-align:center; padding:80px;">
        <div style="font-size:40px; font-weight:600; margin-bottom:16px;">${escapeHtml(prTitle)}</div>
        <div style="font-size:22px; color:#94a3b8;">${escapeHtml(prUrl)}</div>
      </div>`;
}

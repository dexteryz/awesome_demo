import { escapeHtml } from "../html-utils.js";

const CAPTION_STYLE =
  "position:absolute; left:50%; bottom:60px; transform:translateX(-50%); background:rgba(15,23,42,0.85); " +
  "color:#fff; font-size:32px; font-weight:600; padding:16px 32px; border-radius:12px; max-width:80%; " +
  "text-align:center;";

export function successStepHtml(params: {
  start: number;
  duration: number;
  clipSrc: string;
  captionText: string;
  audioSrc?: string;
  showCaption: boolean;
}): string {
  const { start, duration, clipSrc, captionText, audioSrc, showCaption } = params;
  const audioTag = audioSrc
    ? `\n      <audio class="clip" data-start="${start}" data-duration="${duration}" data-volume="1.0"
             src="${escapeHtml(audioSrc)}"></audio>`
    : "";
  const captionTag = showCaption
    ? `\n      <div class="clip" data-start="${start}" data-duration="${duration}" data-track-index="1"
           style="${CAPTION_STYLE}">${escapeHtml(captionText)}</div>`
    : "";
  return `
      <video class="clip" data-start="${start}" data-duration="${duration}" data-track-index="0"
             data-media-start="0" muted src="${escapeHtml(clipSrc)}"
             style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; background:#000;"></video>${captionTag}${audioTag}`;
}

export function failedStepFallbackHtml(params: {
  start: number;
  duration: number;
  captionText: string;
  audioSrc?: string;
}): string {
  const { start, duration, captionText, audioSrc } = params;
  const audioTag = audioSrc
    ? `\n      <audio class="clip" data-start="${start}" data-duration="${duration}" data-volume="1.0"
             src="${escapeHtml(audioSrc)}"></audio>`
    : "";
  return `
      <div class="clip" data-start="${start}" data-duration="${duration}" data-track-index="0"
           style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
                  justify-content:center; background:#1e293b; color:#94a3b8; text-align:center; padding:80px;">
        <div style="font-size:32px; font-weight:600; margin-bottom:12px;">${escapeHtml(captionText)}</div>
        <div style="font-size:20px; font-style:italic;">(this step could not be captured)</div>
      </div>${audioTag}`;
}

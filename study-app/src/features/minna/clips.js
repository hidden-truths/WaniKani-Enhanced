// The per-conversation-line clip marker. A line's native-compare target is a CLIP of the one whole-
// conversation MP3; this owns the affordance (current clip + Set/Edit), the scrubbable marker panel,
// and the attach-once delegated wiring. Writes go through the synced clip store (setLineClip) so the
// slice rides across devices. The marker uses a real <audio controls crossorigin="use-credentials">
// so the browser gives us scrubbing + currentTime for free (the cookie authorizes the gated
// cross-origin audio). renderMinnaLesson is re-imported from view.js at runtime (the package's
// view⇄clips cycle, fine like cloud⇄minna — the reference only fires inside the click handler).
import { API_BASE } from '../../config.js';
import { escapeHtml, clipLabel, validClip } from '../../core/index.js';
import { setSyncStatus } from '../cloud-core.js';
import { getLineClip, setLineClip } from './store.js';
import { renderMinnaLesson } from './view.js';

// The clip affordance per conversation line: a current-clip readout + a Set/Edit button that opens
// the in-app marker (wired in wireMinnaClips). `idx` is the line index.
export function clipAffordanceHtml(idx, clip) {
  return `<div class="clip-zone" data-cidx="${idx}">${clipZoneInner(idx, clip)}</div>`;
}
function clipZoneInner(idx, clip) {
  const label = clipLabel(clip);
  return `${label ? `<span class="clip-current" title="Native clip for this line">clip ${escapeHtml(label)}</span>` : ''}
    <button class="clip-edit" type="button" data-clip-edit="${idx}">${label ? 'Edit clip' : 'Set clip'}</button>`;
}
// The marker panel — a scrubbable native-audio player + Set start / Set end / Save.
function markerHtml(idx, audioSrc, clip) {
  const v = validClip(clip);
  const fmt = t => (v == null && t == null) ? '–' : Number(t).toFixed(1) + 's';
  return `<div class="clip-marker" data-cidx="${idx}" data-start="${v ? v[0] : ''}" data-end="${v ? v[1] : ''}">
    <audio class="clip-audio" controls crossorigin="use-credentials" preload="metadata" src="${API_BASE}/v1/audio/native?src=${encodeURIComponent(audioSrc)}"></audio>
    <div class="clip-marker-row">
      <button class="chip" type="button" data-clip-setstart>Set start</button>
      <button class="chip" type="button" data-clip-setend>Set end</button>
      <span class="clip-readout">start <b class="cm-start">${v ? fmt(v[0]) : '–'}</b> · end <b class="cm-end">${v ? fmt(v[1]) : '–'}</b></span>
      <button class="chip clip-save" type="button" data-clip-save>Save</button>
      <button class="chip" type="button" data-clip-cancel>Cancel</button>
    </div>
    <div class="clip-tip">Play the conversation, then mark where this line starts and ends.</div>
  </div>`;
}
// Delegated wiring for the per-line clip marker. Attach-once (body persists across re-renders); all
// context — the lesson number and the conversation audio src — is read off the line's sibling
// rec-control dataset, so the handler needs no closure over L/n.
export function wireMinnaClips(body) {
  if (body.dataset.clipWired) return;
  body.dataset.clipWired = '1';
  const lessonOf = el => { const rc = el.closest('.mn-line-rec') && el.closest('.mn-line-rec').querySelector('.rec-control'); return rc ? { lesson: Number(rc.dataset.lesson), audioSrc: rc.dataset.native } : null; };
  body.addEventListener('click', e => {
    const edit = e.target.closest('[data-clip-edit]');
    if (edit) {
      const ctx = lessonOf(edit); if (!ctx || !ctx.audioSrc) return;
      const idx = Number(edit.dataset.clipEdit);
      edit.closest('.clip-zone').innerHTML = markerHtml(idx, ctx.audioSrc, getLineClip(ctx.lesson, idx));
      return;
    }
    const marker = e.target.closest('.clip-marker');
    if (!marker) return;
    const ctx = lessonOf(marker); if (!ctx) return;
    const idx = Number(marker.dataset.cidx);
    const a = marker.querySelector('.clip-audio');
    if (e.target.closest('[data-clip-setstart]')) { marker.dataset.start = a.currentTime; marker.querySelector('.cm-start').textContent = a.currentTime.toFixed(1) + 's'; return; }
    if (e.target.closest('[data-clip-setend]')) { marker.dataset.end = a.currentTime; marker.querySelector('.cm-end').textContent = a.currentTime.toFixed(1) + 's'; return; }
    if (e.target.closest('[data-clip-cancel]')) { marker.closest('.clip-zone').innerHTML = clipZoneInner(idx, getLineClip(ctx.lesson, idx)); return; }
    if (e.target.closest('[data-clip-save]')) {
      const clip = validClip([Number(marker.dataset.start), Number(marker.dataset.end)]);
      if (!clip) { marker.querySelector('.clip-tip').textContent = 'Set a start, then an end after it, before saving.'; return; }
      setLineClip(ctx.lesson, idx, clip);
      setSyncStatus('✓ clip saved');
      renderMinnaLesson(ctx.lesson, body);   // re-render so the rec-control picks up the new clip
    }
  });
}

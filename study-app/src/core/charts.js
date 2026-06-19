// Pure chart + stat builders for the Stats panel — DOM-free, so they're unit-tested
// like the rest of src/core/* (this is the "extract the pure logic, then test it" net
// the other feature modules already got). features/stats.js was the last large render
// module mixing real aggregation logic AND hand-rolled SVG/HTML string-building straight
// into DOM mutation; the pure parts move here and stats.js keeps only the glue
// (read state → call these → write innerHTML / set badges / run the draw-in animation).
//
// The SVG / HTML strings are reproduced BYTE-FOR-BYTE from the old inline code so the
// rendered charts are pixel-identical — these functions return strings, never touch the
// DOM, and read no app state (callers pass `sessions` / `boxes` / `pts` / `nowMs` in).
// Charts stay hand-rolled (no chart library — a study-app dead-end); this just makes the
// geometry testable.

// Split the session ledger into SRS vs free-study tallies and the overall accuracy.
// Reviews + accuracy come from the SESSION ledger (not the per-card attempt sum) so the
// Total / SRS / Free tiles reconcile (Total = SRS + Free) and accuracy shares their
// denominator. A session with no `kind` (legacy) counts as SRS — the old behavior.
export function accuracyMix(sessions) {
    const mix = { srs: { rev: 0, right: 0 }, free: { rev: 0, right: 0 } };
    for (const s of sessions) {
        const m = mix[s.kind === 'free' ? 'free' : 'srs'];
        m.rev += s.tot;
        m.right += s.right;
    }
    const tot = mix.srs.rev + mix.free.rev,
        right = mix.srs.right + mix.free.right;
    const overall = tot ? Math.round((100 * right) / tot) : 0;
    return { srs: mix.srs, free: mix.free, tot, right, overall };
}

// Week-over-week accuracy delta in PERCENTAGE POINTS, from the session ledger — the
// trend pill on the accuracy hero. `null` when there isn't a full prior week to compare
// against (so the caller falls back to a plain sublabel). `nowMs` is injected (not
// Date.now()) so this stays pure + testable.
export function weekOverWeekDelta(sessions, nowMs) {
    const WK = 7 * 864e5;
    const win = { tw: { r: 0, t: 0 }, lw: { r: 0, t: 0 } };
    for (const s of sessions) {
        if (!s.t) continue;
        if (s.t >= nowMs - WK) {
            win.tw.r += s.right;
            win.tw.t += s.tot;
        } else if (s.t >= nowMs - 2 * WK) {
            win.lw.r += s.right;
            win.lw.t += s.tot;
        }
    }
    return win.tw.t && win.lw.t ? Math.round((100 * win.tw.r) / win.tw.t - (100 * win.lw.r) / win.lw.t) : null;
}

// Count cards per Leitner box (index 0 = New … 5 = best-learned) over the live deck.
// A card with no progress row, or box 0/falsy, lands in box 0.
export function boxCounts(data, cards) {
    const boxes = [0, 0, 0, 0, 0, 0];
    for (const v of data) {
        const c = cards[v.rank];
        const b = c && c.box ? c.box : 0;
        boxes[b]++;
    }
    return boxes;
}

// Daily-accuracy line chart → an SVG string for a 0–100% series. Assumes a non-empty
// `pts` (= [{y, label}]); the caller handles the empty state. A zoomed y-axis (so a high,
// flat series still uses the canvas), an area gradient, a gold dashed average, the jade
// line (`#dailyLine`, animated by the caller after mount), dots, and ~5 sparse date ticks
// whose last reads "today". All colors are CSS vars → the chart re-tints on a theme flip
// with no re-render.
export function dailyAccuracySvg(pts) {
    const W = 620,
        H = 270,
        pad = { l: 34, r: 16, t: 20, b: 30 };
    const iw = W - pad.l - pad.r,
        ih = H - pad.t - pad.b;
    const vals = pts.map((p) => p.y),
        n = vals.length;
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / n);
    // adaptive zoom: floor a touch below the min (rounded to 5, capped at 80) so even a
    // high, flat series uses the canvas instead of floating in the top third; ceil 100.
    const ymin = Math.min(80, Math.floor(Math.max(0, Math.min(...vals) - 8) / 5) * 5),
        ymax = 100;
    const xOf = (i) => pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const yOf = (v) => pad.t + ih - ((v - ymin) / (ymax - ymin)) * ih;
    let g = `<svg class="dl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily accuracy over ${n} day${n === 1 ? '' : 's'}, percent correct">`;
    g += `<defs><linearGradient id="dlArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--dl-line)" stop-opacity=".26"/><stop offset="100%" stop-color="var(--dl-line)" stop-opacity="0"/></linearGradient></defs>`;
    // faint gridlines + y labels at the multiples of 10 inside the zoomed range
    for (let v = Math.ceil(ymin / 10) * 10; v <= 100; v += 10) {
        const y = yOf(v);
        g += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="var(--line)" stroke-width="1" opacity=".55"/><text x="${pad.l - 8}" y="${y + 3.5}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)" opacity=".85">${v}</text>`;
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');
    g += `<path d="${d} L${xOf(n - 1).toFixed(1)},${yOf(ymin)} L${xOf(0).toFixed(1)},${yOf(ymin)} Z" fill="url(#dlArea)"/>`;
    const ay = yOf(avg);
    g += `<line x1="${pad.l}" y1="${ay}" x2="${W - pad.r}" y2="${ay}" stroke="var(--gold)" stroke-width="2.5" stroke-dasharray="8 5" opacity=".9"/><text x="${W - pad.r}" y="${ay - 7}" text-anchor="end" font-size="11.5" fill="var(--gold)" font-family="var(--mono)" font-weight="500">avg ${avg}%</text>`;
    g += `<path id="dailyLine" d="${d}" fill="none" stroke="var(--dl-line)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    pts.forEach((p, i) => {
        const cx = xOf(i),
            cy = yOf(p.y),
            last = i === n - 1;
        g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${last ? 5 : 3.2}" fill="${last ? 'var(--dl-line)' : 'var(--paper)'}" stroke="var(--dl-line)" stroke-width="${last ? 0 : 2}"><title>${p.label}: ${p.y}%</title></circle>`;
    });
    // ~5 evenly-spaced date ticks; the last reads "today"
    const ticks = [...new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1])];
    ticks.forEach((i) => {
        g += `<text x="${xOf(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="var(--muted)" font-family="var(--mono)">${i === n - 1 ? 'today' : pts[i].label}</text>`;
    });
    g += '</svg>';
    return g;
}

// SRS memory-pipeline histogram → the inner HTML for #boxDist: six VERTICAL bars on the
// stone→jade Leitner ramp. Bar height is PROPORTIONAL to the box count (tallest → ~88%),
// honestly reflecting the numbers (NOT range-normalized, which squished heights when one
// box was an outlier); a small floor keeps tiny boxes visible, 0 → a stub. The count sits
// inside tall bars and floats above short ones; box 5 is the best-learned. The glossy
// light-top gradient is set inline (blend) for BOTH themes; stats.css adds the highlight.
export function pipelineHtml(boxes) {
    const boxName = ['New', 'Box 1', 'Box 2', 'Box 3', 'Box 4', 'Box 5'];
    const boxInt = ['unseen', '1 day', '2 days', '4 days', '8 days', '16 days'];
    const maxBox = Math.max(...boxes, 1);
    const pcols = boxes
        .map((n, i) => {
            const h = n === 0 ? 3 : Math.max(7, Math.round((n / maxBox) * 88));
            const above = h < 58; // shorter bars float the count above
            const grad = `linear-gradient(180deg, color-mix(in srgb,var(--box-${i}) 80%, #fff) 0%, var(--box-${i}) 58%, color-mix(in srgb,var(--box-${i}) 72%, #000) 100%)`;
            return `<div class="pcol${i === 5 ? ' best' : ''}"><div class="pbar-track"><div class="pbar${above ? ' count-above' : ''}" style="height:${h}%;background:${grad};animation-delay:${(0.3 + i * 0.06).toFixed(2)}s"><span class="count">${n}</span></div></div><div class="plabel"><b>${boxName[i]}</b>${boxInt[i]}</div></div>`;
        })
        .join('');
    const swatches = boxes.map((n, i) => `<i style="background:var(--box-${i})"></i>`).join('');
    return `<div class="pipeline">${pcols}</div><div class="pipe-legend"><span>least learned</span><span class="ramp"><span class="swatches">${swatches}</span></span><span>best learned</span></div>`;
}

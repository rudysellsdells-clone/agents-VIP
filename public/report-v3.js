(() => {
  const W = 816;
  const H = 1056;
  const NAVY = '#062f6c';
  const BODY = '#173f73';
  const RED = '#e84e3c';
  const AMBER = '#f2a20c';
  const GREEN = '#30ad66';
  const audits = new Map();
  const prospects = new Map();
  let scanTimer = null;

  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const score = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  };

  const hostKey = (value) => {
    try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return String(value || '').toLowerCase().replace(/^www\./, ''); }
  };

  const dateLabel = (value) => {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return 'Not available';
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(d);
  };

  const rows = (audit) => {
    const s = audit?.scores || {};
    return [
      ['Content Freshness', s.contentFreshness, 'content_freshness'],
      ['Site Structure', s.siteStructure, 'site_structure'],
      ['Conversion', s.conversion, 'conversion'],
      ['Technical SEO', s.technicalSeo, 'technical_seo'],
      ['Performance', s.performance, 'performance'],
      ['Platform Health', s.platformHealth, 'platform_health'],
      ['Trust', s.trust, 'trust'],
      ['AI Discoverability', s.aiDiscoverability, 'ai_discoverability']
    ].map(([label, value, area]) => [label, score(value), area]);
  };

  const execRows = (audit) => rows(audit).filter(([, , area]) => area !== 'performance').slice(0, 7);

  const scoreForArea = (audit, area) => {
    const found = rows(audit).find(([, , key]) => key === area);
    return found ? found[1] : null;
  };

  const findingArea = (finding) => String(finding?.area || '').toLowerCase().replaceAll(' ', '_');

  const priorityFor = (audit, finding) => {
    const explicit = String(finding?.severity || '').toLowerCase();
    if (['critical', 'high'].includes(explicit)) return 'high';
    if (['medium', 'moderate'].includes(explicit)) return 'medium';
    if (['low', 'info', 'informational'].includes(explicit)) return 'optimization';
    const area = findingArea(finding);
    const aliases = {
      content_freshness: 'content_freshness', site_structure: 'site_structure', conversion: 'conversion',
      conversion_architecture: 'conversion', technical_seo: 'technical_seo', structured_data: 'technical_seo',
      performance: 'performance', platform_health: 'platform_health', platform: 'platform_health',
      trust: 'trust', ai_discoverability: 'ai_discoverability', ai_discovery: 'ai_discoverability'
    };
    const n = scoreForArea(audit, aliases[area] || area);
    if (n !== null && n < 50) return 'high';
    if (n !== null && n < 70) return 'medium';
    return 'optimization';
  };

  const fallbackFinding = (audit, area, label) => {
    const n = scoreForArea(audit, area);
    const templates = {
      content_freshness: ['Refresh aging content', 'Review older service and resource content, then update the pages that most influence relevance and buyer confidence.'],
      site_structure: ['Clarify site structure', 'Make key services, proof, and next steps easier to find from primary navigation and high-intent pages.'],
      conversion: ['Strengthen conversion paths', 'Use clearer service-specific next steps and reduce friction between visitor intent and inquiry.'],
      technical_seo: ['Improve technical SEO signals', 'Tighten metadata, structured data, crawl signals, and page-level search fundamentals where the audit found gaps.'],
      performance: ['Improve performance', 'Prioritize the measured speed and page-experience issues that can create friction for visitors and search engines.'],
      platform_health: ['Review platform modernization', 'Review observable platform and front-end implementation signals for practical modernization opportunities.'],
      trust: ['Expand trust-building content', 'Strengthen proof, expertise, team credibility, and confidence signals near important conversion points.'],
      ai_discoverability: ['Enhance AI discoverability', 'Clarify services, outcomes, business identity, and structured information for machine-readable understanding.']
    };
    const [headline, implication] = templates[area] || ['Review ' + label, 'Review this measured area and prioritize the most commercially meaningful improvements.'];
    return { area, finding: headline + (n !== null ? ` (${n}/100)` : ''), businessImplication: implication, severity: n !== null && n < 50 ? 'high' : n !== null && n < 70 ? 'medium' : 'low' };
  };

  const allFindings = (audit) => {
    const list = Array.isArray(audit?.findings) ? audit.findings.filter((f) => f?.finding) : [];
    const preferred = rows(audit).map(([label, , area]) => area);
    const out = [...list];
    for (const area of preferred) {
      if (!out.some((f) => findingArea(f).includes(area.replace('_health', '')))) {
        const label = rows(audit).find(([, , key]) => key === area)?.[0] || area;
        out.push(fallbackFinding(audit, area, label));
      }
    }
    return out;
  };

  const groupsFor = (audit) => {
    const groups = { high: [], medium: [], optimization: [] };
    for (const f of allFindings(audit)) groups[priorityFor(audit, f)].push(f);
    const sort = (a, b) => {
      const aa = scoreForArea(audit, findingArea(a)) ?? 100;
      const bb = scoreForArea(audit, findingArea(b)) ?? 100;
      return aa - bb;
    };
    Object.values(groups).forEach((g) => g.sort(sort));
    return groups;
  };

  const topFindings = (audit, limit = 3) => {
    const g = groupsFor(audit);
    return [...g.high, ...g.medium, ...g.optimization].slice(0, limit);
  };

  const findFor = (audit, keys, fallbackArea, fallbackLabel) => {
    const all = allFindings(audit);
    const hit = all.find((f) => keys.some((k) => findingArea(f).includes(k)));
    return hit || fallbackFinding(audit, fallbackArea, fallbackLabel);
  };

  const assessment = (value) => {
    const n = score(value);
    if (n === null) return ['Measured Opportunities', 'The audit identified measurable areas that deserve review.'];
    if (n < 45) return ['Significant Opportunity.', 'The site has substantial opportunities across several measured areas.'];
    if (n < 65) return ['Good Potential.\nClear Opportunities.', 'The site has a workable foundation with meaningful opportunities across several key areas.'];
    if (n < 80) return ['Solid Foundation.\nTargeted Improvements.', 'The site is fundamentally sound, with focused improvements that can strengthen visibility and conversion.'];
    return ['Strong Foundation.\nOptimization Ahead.', 'The site performs well overall, with incremental opportunities to improve clarity, trust, and discoverability.'];
  };

  const executiveSummary = (audit) => {
    const top = topFindings(audit, 3).map((f) => String(f.finding || '').replace(/\s*\(\d+\/100\)$/, '').toLowerCase());
    const joined = top.length ? top.join(', ') : 'content, conversion, search visibility, and trust';
    return `Our analysis shows meaningful opportunities in ${joined}. Addressing the highest-impact areas can strengthen visibility, visitor confidence, and the path from interest to inquiry.`;
  };

  const mobileLabel = (audit) => {
    const n = score(audit?.scores?.mobile);
    if (n === null) return 'Not measured';
    if (n < 50) return 'Needs Improvement';
    if (n < 70) return 'Fair to Good';
    return 'Good';
  };

  function wrapLines(ctx, text, maxWidth) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const test = line + ' ' + words[i];
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
    return lines;
  }

  function fitText(ctx, text, box, options = {}) {
    const { maxSize = 18, minSize = 9, weight = 400, family = 'Arial, Helvetica, sans-serif', color = BODY, lineHeight = 1.2, maxLines = 3, align = 'left', valign = 'top', ellipsis = true } = options;
    let size = maxSize;
    let lines = [];
    while (size >= minSize) {
      ctx.font = `${weight} ${size}px ${family}`;
      lines = wrapLines(ctx, text, box.w);
      const height = lines.length * size * lineHeight;
      if (lines.length <= maxLines && height <= box.h) break;
      size -= 0.5;
    }
    ctx.font = `${weight} ${size}px ${family}`;
    lines = wrapLines(ctx, text, box.w);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      if (ellipsis) {
        let last = lines[maxLines - 1];
        while (last && ctx.measureText(last + '…').width > box.w) last = last.slice(0, -1).trim();
        lines[maxLines - 1] = last.replace(/[.,;:]$/, '') + '…';
      }
    }
    const lh = size * lineHeight;
    const total = lines.length * lh;
    let y = box.y + size;
    if (valign === 'middle') y = box.y + (box.h - total) / 2 + size;
    if (valign === 'bottom') y = box.y + box.h - total + size;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lh));
    return { size, lines };
  }

  function mask(ctx, x, y, w, h, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function gradientMask(ctx, x, y, w, h, a, b) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, a); grad.addColorStop(1, b);
    mask(ctx, x, y, w, h, grad);
  }

  function scoreColor(n) { return n === null ? '#778da6' : n < 50 ? RED : n < 70 ? AMBER : GREEN; }

  function roundRect(ctx, x, y, w, h, r, fill) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
    if (fill) ctx.fill();
  }

  function drawScore(ctx, n, box, barBox, bg = '#f5f9fc') {
    mask(ctx, box.x, box.y, box.w, box.h, bg);
    const v = n === null ? '—' : String(n);
    fitText(ctx, v, box, { maxSize: 27, minSize: 20, weight: 700, color: scoreColor(n), maxLines: 1, align: 'center', valign: 'middle' });
    if (barBox) {
      ctx.fillStyle = '#d7e3ee';
      roundRect(ctx, barBox.x, barBox.y, barBox.w, barBox.h, 4, true);
      if (n !== null) { ctx.fillStyle = scoreColor(n); roundRect(ctx, barBox.x, barBox.y, barBox.w * n / 100, barBox.h, 4, true); }
    }
  }

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
  });

  async function backgrounds() {
    const p1 = window.WSP_REPORT_TEMPLATE_PAGE1;
    const p2raw = window.WSP_REPORT_TEMPLATE_PAGE2;
    const p3raw = window.WSP_REPORT_TEMPLATE_PAGE3;
    if (!p1 || !p2raw || !p3raw) throw new Error('Report template artwork did not load.');
    const p2 = p2raw.startsWith('data:') ? p2raw : 'data:image/avif;base64,' + p2raw;
    const p3 = p3raw.startsWith('data:') ? p3raw : 'data:image/avif;base64,' + p3raw;
    return Promise.all([loadImage(p1), loadImage(p2), loadImage(p3)]);
  }

  function baseCanvas(img) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, W, H); return [canvas, ctx];
  }

  function drawPage1(img, audit) {
    const [canvas, ctx] = baseCanvas(img);
    const overall = score(audit.websiteHealthScore);
    const [headline, body] = assessment(overall);
    mask(ctx, 118, 276, 458, 78, '#ffffff');
    fitText(ctx, audit.companyName || 'Website', { x: 123, y: 279, w: 450, h: 28 }, { maxSize: 22, minSize: 15, weight: 700, color: NAVY, maxLines: 1, valign: 'middle' });
    fitText(ctx, `Website: ${audit.website || 'Not available'}`, { x: 123, y: 308, w: 450, h: 18 }, { maxSize: 13, minSize: 10, color: BODY, maxLines: 1 });
    fitText(ctx, `Audit Date: ${dateLabel(audit.auditedAt)}`, { x: 123, y: 329, w: 450, h: 17 }, { maxSize: 13, minSize: 10, color: BODY, maxLines: 1 });
    mask(ctx, 106, 464, 151, 76, '#0a3e78');
    fitText(ctx, overall === null ? '—' : String(overall), { x: 112, y: 468, w: 104, h: 68 }, { maxSize: 60, minSize: 45, weight: 700, color: '#ffffff', maxLines: 1, align: 'center', valign: 'middle' });
    fitText(ctx, '/100', { x: 202, y: 488, w: 62, h: 40 }, { maxSize: 27, minSize: 22, weight: 300, color: '#ffffff', maxLines: 1, valign: 'middle' });
    gradientMask(ctx, 360, 432, 343, 151, '#0d4b87', '#1674b5');
    fitText(ctx, 'OVERALL ASSESSMENT', { x: 368, y: 438, w: 290, h: 18 }, { maxSize: 10, minSize: 9, color: '#bce0fa', maxLines: 1 });
    fitText(ctx, headline, { x: 368, y: 469, w: 300, h: 64 }, { maxSize: 24, minSize: 18, weight: 700, color: '#ffffff', maxLines: 2 });
    fitText(ctx, body, { x: 368, y: 533, w: 300, h: 45 }, { maxSize: 13, minSize: 10.5, color: '#edf8ff', maxLines: 3 });
    mask(ctx, 104, 669, 645, 67, '#ffffff');
    fitText(ctx, executiveSummary(audit), { x: 105, y: 670, w: 635, h: 61 }, { maxSize: 14, minSize: 11, color: BODY, maxLines: 3, lineHeight: 1.28 });
    const xs = [25, 136, 247, 358, 469, 580, 691];
    execRows(audit).forEach(([, n], i) => drawScore(ctx, n, { x: xs[i] + 9, y: 809, w: 82, h: 32 }, { x: xs[i] + 14, y: 846, w: 72, h: 7 }));
    mask(ctx, 365, 888, 358, 79, '#edf7fd');
    topFindings(audit, 3).forEach((f, i) => {
      const text = String(f.finding || 'Website improvement opportunity').replace(/\s*\(\d+\/100\)$/, '');
      fitText(ctx, text, { x: 369, y: 891 + i * 23, w: 350, h: 20 }, { maxSize: 12.5, minSize: 9.5, color: BODY, maxLines: 1, valign: 'middle' });
    });
    return canvas;
  }

  function drawPage2(img, audit) {
    const [canvas, ctx] = baseCanvas(img);
    const values = rows(audit);
    const xs = [36, 171, 306, 441];
    values.slice(0, 4).forEach(([, n], i) => drawScore(ctx, n, { x: xs[i] + 12, y: 430, w: 104, h: 37 }, { x: xs[i] + 13, y: 469, w: 99, h: 8 }));
    values.slice(4, 8).forEach(([, n], i) => drawScore(ctx, n, { x: xs[i] + 12, y: 595, w: 104, h: 37 }, { x: xs[i] + 13, y: 635, w: 99, h: 8 }));
    const cms = audit?.platform?.cmsDetected || 'Not publicly determined';
    const snapshot = [[String(Number(audit.pagesSampled || 0)), 654, 450, 117, 27, 20], [String(Number(audit.auditConfidence || 0)) + '%', 654, 516, 117, 28, 20], [cms, 654, 584, 117, 35, 17], [mobileLabel(audit), 654, 650, 117, 38, 16]];
    snapshot.forEach(([text, x, y, w, h, sz]) => { mask(ctx, x, y, w, h, '#edf6fc'); fitText(ctx, text, { x, y, w, h }, { maxSize: sz, minSize: 11, weight: 700, color: NAVY, maxLines: 2, valign: 'middle' }); });
    const findingCards = [
      [findFor(audit, ['content_freshness', 'freshness'], 'content_freshness', 'Content Freshness'), 120, 760, 276, 84, '#fff4f2', '#b5211c'],
      [findFor(audit, ['conversion'], 'conversion', 'Conversion'), 495, 760, 276, 84, '#fff7f1', '#b5211c'],
      [findFor(audit, ['technical_seo', 'structured_data', 'seo'], 'technical_seo', 'Technical SEO'), 120, 865, 276, 86, '#fff9ed', '#9d5b00'],
      [findFor(audit, ['platform'], 'platform_health', 'Platform Health'), 495, 865, 276, 86, '#f1f8fd', NAVY]
    ];
    findingCards.forEach(([f, x, y, w, h, bg, heading]) => {
      mask(ctx, x, y, w, h, bg);
      fitText(ctx, String(f.finding || '').replace(/\s*\(\d+\/100\)$/, ''), { x, y: y + 2, w: w - 7, h: 25 }, { maxSize: 15, minSize: 11, weight: 700, color: heading, maxLines: 1 });
      fitText(ctx, f.businessImplication || f.whyItMatters || '', { x, y: y + 29, w: w - 8, h: h - 32 }, { maxSize: 12.5, minSize: 9.5, color: BODY, maxLines: 3, lineHeight: 1.22 });
    });
    return canvas;
  }

  function recommendationRows(audit) {
    const g = groupsFor(audit); const used = new Set();
    const take = (source, count) => { const out = []; for (const f of source) { const key = String(f.finding || ''); if (used.has(key)) continue; used.add(key); out.push(f); if (out.length === count) break; } return out; };
    const all = [...g.high, ...g.medium, ...g.optimization];
    const high = take(g.high, 3); while (high.length < 3) high.push(...take(all, 1));
    const med = take(g.medium, 2); while (med.length < 2) med.push(...take(all, 1));
    const opt = take(g.optimization, 1); while (opt.length < 1) opt.push(...take(all, 1));
    return { high: high.slice(0, 3), medium: med.slice(0, 2), optimization: opt.slice(0, 1) };
  }

  function drawRecommendation(ctx, f, y, bg) {
    mask(ctx, 304, y, 399, 58, bg);
    const headline = String(f?.finding || 'Website improvement opportunity').replace(/\s*\(\d+\/100\)$/, '');
    fitText(ctx, headline, { x: 306, y: y + 1, w: 390, h: 24 }, { maxSize: 15, minSize: 11, weight: 700, color: NAVY, maxLines: 1 });
    fitText(ctx, f?.businessImplication || f?.whyItMatters || 'Prioritize the most commercially meaningful improvement in this area.', { x: 306, y: y + 25, w: 390, h: 31 }, { maxSize: 11.5, minSize: 9, color: BODY, maxLines: 2, lineHeight: 1.2 });
  }

  function drawPage3(img, audit) {
    const [canvas, ctx] = baseCanvas(img); const g = recommendationRows(audit);
    [365, 430, 492].forEach((y, i) => drawRecommendation(ctx, g.high[i], y, '#fbfdff'));
    [560, 622].forEach((y, i) => drawRecommendation(ctx, g.medium[i], y, '#fbfdff'));
    drawRecommendation(ctx, g.optimization[0], 712, '#f6fbfd');
    return canvas;
  }

  async function renderCanvases(audit) { const [a, b, c] = await backgrounds(); return [drawPage1(a, audit), drawPage2(b, audit), drawPage3(c, audit)]; }
  const filename = (audit) => (String(audit.companyName || 'website').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'website') + '-website-intelligence-report.pdf';

  async function makePdf(audit, save = true) {
    const JsPDF = window.jspdf?.jsPDF; if (!JsPDF) throw new Error('PDF library has not loaded yet.');
    const canvases = await renderCanvases(audit); const doc = new JsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
    canvases.forEach((canvas, i) => { if (i) doc.addPage('letter', 'portrait'); doc.addImage(canvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, 612, 792, undefined, 'FAST'); });
    if (save) doc.save(filename(audit)); return doc;
  }

  function toast(message) { document.querySelector('.wir3-toast')?.remove(); const n = document.createElement('div'); n.className = 'wir3-toast'; n.textContent = message; document.body.appendChild(n); setTimeout(() => n.remove(), 3000); }

  async function preview(audit) {
    injectStyles(); document.querySelector('.wir3-overlay')?.remove();
    const overlay = document.createElement('div'); overlay.className = 'wir3-overlay';
    overlay.innerHTML = '<div class="wir3-modal"><div class="wir3-toolbar"><button data-wir3-pdf>Download PDF</button><button data-wir3-print>Print</button><button data-wir3-email>Email Report</button><button data-wir3-copy>Copy Email</button><button class="wir3-close" data-wir3-close>Close</button></div><div class="wir3-pages"><div class="wir3-loading">Rendering approved WSP report template…</div></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('[data-wir3-close]').onclick = () => overlay.remove();
    overlay.querySelector('[data-wir3-pdf]').onclick = () => makePdf(audit, true).catch((e) => toast(e.message));
    overlay.querySelector('[data-wir3-print]').onclick = () => printReport(audit).catch((e) => toast(e.message));
    overlay.querySelector('[data-wir3-email]').onclick = () => emailReport(audit).catch((e) => toast(e.message));
    overlay.querySelector('[data-wir3-copy]').onclick = () => copyEmail(audit);
    try { const canvases = await renderCanvases(audit); const pages = overlay.querySelector('.wir3-pages'); pages.innerHTML = ''; canvases.forEach((canvas) => { canvas.className = 'wir3-page'; pages.appendChild(canvas); }); }
    catch (e) { overlay.querySelector('.wir3-loading').textContent = e.message; }
  }

  async function printReport(audit) {
    const canvases = await renderCanvases(audit); const popup = window.open('', '_blank'); if (!popup) return toast('Allow pop-ups to print the report.');
    const imgs = canvases.map((c) => `<img src="${c.toDataURL('image/jpeg', .94)}">`).join('');
    popup.document.write(`<!doctype html><html><head><title>${esc(audit.companyName)} Website Intelligence Report</title><style>@page{size:letter;margin:0}body{margin:0;background:#fff}img{display:block;width:8.5in;height:11in;page-break-after:always}</style></head><body>${imgs}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`); popup.document.close();
  }

  const emailDraft = (audit) => {
    const top = topFindings(audit, 2).map((f) => String(f.finding || '').replace(/\s*\(\d+\/100\)$/, ''));
    return { subject: `Website Intelligence Report for ${audit.companyName}`, body: ['Hi,', '', `I took a look at the public-facing website for ${audit.companyName} and put together a short Website Intelligence Report.`, top.length ? `A couple of things that stood out were: ${top.join('; ')}.` : 'It highlights several measurable areas that may be worth reviewing.', '', "I've attached the report so you can see the scorecard, supporting findings, and a practical 90-day improvement path.", '', "If it would be useful, I'd be happy to walk through the findings with you.", '', 'Rudy McCormick', 'Web Search Professionals', 'web-search-pros.com'].join('\n') };
  };

  async function copyEmail(audit) { const d = emailDraft(audit); try { await navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`); toast('Email draft copied.'); } catch { toast('Could not copy the email draft.'); } }
  const prospectEmail = (audit) => { const card = [...document.querySelectorAll('.prospect-card')].find((node) => hostKey(node.querySelector('.website-link')?.href) === hostKey(audit.website)); return card?.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.replace(/^mailto:/i, '') || prospects.get(hostKey(audit.website))?.email || ''; };
  async function emailReport(audit) { await makePdf(audit, true); const d = emailDraft(audit); const email = prospectEmail(audit); toast('PDF downloaded. Attach it to the email before sending.'); setTimeout(() => { location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body + '\n\nThe PDF report has been downloaded and is ready to attach.')}`; }, 400); }

  function captureAudit(audit, context = {}) {
    if (!audit) return; const key = hostKey(audit.website || context.website); if (!key) return;
    audits.set(key, { ...audit, companyName: audit.companyName || context.companyName || 'Website', website: audit.website || context.website || '', auditedAt: audit.auditedAt || audit.audited_at || new Date().toISOString() });
    prospects.set(key, { ...prospects.get(key), ...context }); scheduleScan();
  }

  function capturePayload(data) {
    if (!data || typeof data !== 'object') return;
    if (data.enrichment?.websiteAudit) captureAudit(data.enrichment.websiteAudit, { companyName: data.enrichment.companyName, website: data.enrichment.website });
    if (data.job?.items) for (const item of data.job.items) if (item.enrichment?.websiteAudit) captureAudit(item.enrichment.websiteAudit, { companyName: item.company_name, website: item.website, email: item.contact_resolution?.primaryDecisionMaker?.publicBusinessEmail || '' });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => { const response = await originalFetch(...args); try { const clone = response.clone(); if ((clone.headers.get('content-type') || '').includes('application/json')) clone.json().then(capturePayload).catch(() => {}); } catch {} return response; };

  function injectActions(card, audit) {
    let box = card.querySelector('.wir3-actions'); if (box) { box.dataset.auditKey = hostKey(audit.website); return; }
    const target = card.querySelector('.prospect-enrichment') || card; box = document.createElement('div'); box.className = 'wir3-actions'; box.dataset.auditKey = hostKey(audit.website);
    box.innerHTML = '<strong>Website Intelligence Report</strong><div><button data-r="preview">Preview</button><button data-r="pdf">Download PDF</button><button data-r="print">Print</button><button data-r="email">Email Report</button></div><small>Uses the approved three-page Web Search Professionals artwork with live audit data.</small>';
    target.parentNode.insertBefore(box, target.nextSibling);
    box.addEventListener('click', (event) => { const action = event.target.closest('[data-r]')?.dataset.r; if (!action) return; const current = audits.get(box.dataset.auditKey) || audit; if (action === 'preview') preview(current); if (action === 'pdf') makePdf(current, true).catch((e) => toast(e.message)); if (action === 'print') printReport(current).catch((e) => toast(e.message)); if (action === 'email') emailReport(current).catch((e) => toast(e.message)); });
  }

  function scan() { injectStyles(); for (const card of document.querySelectorAll('.prospect-card')) { const website = card.querySelector('.website-link')?.href; const audit = audits.get(hostKey(website)); if (audit) injectActions(card, audit); } }
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 80); }

  function injectStyles() {
    if (document.querySelector('#wir3-styles')) return;
    const style = document.createElement('style'); style.id = 'wir3-styles';
    style.textContent = `.wir3-actions{margin:14px 0 4px;padding:12px;border:1px solid #d6e5f1;border-radius:12px;background:#f5faff}.wir3-actions strong{display:block;color:#082b63;margin-bottom:8px}.wir3-actions>div{display:flex;flex-wrap:wrap;gap:7px}.wir3-actions button{border:1px solid #bdd7e9;background:#fff;color:#0b4c86;border-radius:7px;padding:7px 9px;font:700 10px Arial;cursor:pointer}.wir3-actions button:first-child{background:#0f5d9d;color:#fff}.wir3-actions small{display:block;margin-top:7px;color:#607a9c;font-size:9px}.wir3-overlay{position:fixed;inset:0;z-index:99999;background:rgba(4,24,52,.88);overflow:auto;padding:22px}.wir3-modal{max-width:900px;margin:auto}.wir3-toolbar{position:sticky;top:0;z-index:3;display:flex;gap:8px;flex-wrap:wrap;padding:10px;background:#082b63;border-radius:12px 12px 0 0}.wir3-toolbar button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;cursor:pointer;background:#fff;color:#0b4c86}.wir3-toolbar .wir3-close{margin-left:auto;background:#d83c3c;color:#fff}.wir3-pages{padding:18px;background:#eaf1f7}.wir3-page{display:block;width:min(816px,100%);height:auto;margin:0 auto 18px;box-shadow:0 8px 22px rgba(0,0,0,.18)}.wir3-loading{padding:40px;background:#fff;text-align:center;color:#35577d}.wir3-toast{position:fixed;right:20px;bottom:20px;z-index:100000;padding:10px 14px;background:#082b63;color:#fff;border-radius:9px;box-shadow:0 4px 16px rgba(0,0,0,.2)}@media(max-width:860px){.wir3-overlay{padding:0}.wir3-pages{padding:0}.wir3-toolbar .wir3-close{margin-left:0}}`;
    document.head.appendChild(style);
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  window.WebsiteIntelligenceReports = { preview, downloadPdf: makePdf, print: printReport, email: emailReport, captureAudit, renderCanvases };
  injectStyles();
})();
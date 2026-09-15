import PDFDocument from "pdfkit";

const BRAND = {
  navy: "#082b63",
  blue: "#1879bd",
  lightBlue: "#eaf5fc",
  cyan: "#2aa7df",
  ink: "#15365f",
  muted: "#607a9c",
  line: "#d7e5f1",
  red: "#d83c3c",
  orange: "#ee9b12",
  green: "#31a561",
  white: "#ffffff"
};

export const WSP_REPORT_LOGO_URL =
  process.env.WSP_REPORT_LOGO_URL ||
  "https://www.web-search-pros.com/wp-content/uploads/2017/03/Logo_Small-1-300x98.png";

let logoPromise = null;

function scoreValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cleanUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    return "";
  }
}

function shortUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") +
      (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return String(value || "");
  }
}

function formatDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function scoreTone(value) {
  const score = scoreValue(value);
  if (score === null) return { label: "Not measured", color: BRAND.muted };
  if (score < 50) return { label: "Priority opportunity", color: BRAND.red };
  if (score < 70) return { label: "Improvement opportunity", color: BRAND.orange };
  return { label: "Solid foundation", color: BRAND.green };
}

function scoreRows(audit) {
  const scores = audit.scores || {};
  return [
    ["Content Freshness", scores.contentFreshness],
    ["Site Structure", scores.siteStructure],
    ["Conversion", scores.conversion],
    ["Technical SEO", scores.technicalSeo],
    ["Performance", scores.performance],
    ["Mobile", scores.mobile],
    ["Accessibility", scores.accessibility],
    ["Structured Data", scores.structuredData],
    ["Platform Health", scores.platformHealth],
    ["Trust", scores.trust],
    ["AI Discoverability", scores.aiDiscoverability]
  ].filter(([, value]) => scoreValue(value) !== null);
}

function areaScore(audit, area) {
  const map = {
    content_freshness: audit.scores?.contentFreshness,
    site_structure: audit.scores?.siteStructure,
    conversion: audit.scores?.conversion,
    technical_seo: audit.scores?.technicalSeo,
    performance: audit.scores?.performance,
    mobile: audit.scores?.mobile,
    accessibility: audit.scores?.accessibility,
    structured_data: audit.scores?.structuredData,
    platform_health: audit.scores?.platformHealth,
    site_hygiene: audit.scores?.platformHealth,
    trust: audit.scores?.trust,
    ai_discoverability: audit.scores?.aiDiscoverability
  };
  return scoreValue(map[area]);
}

function priorityForFinding(audit, finding) {
  const explicit = String(finding?.severity || "").toLowerCase();
  if (["critical", "high"].includes(explicit)) return "high";
  if (["medium", "moderate"].includes(explicit)) return "medium";
  if (["low", "info", "informational"].includes(explicit)) return "optimization";

  const score = areaScore(audit, finding?.area);
  if (score !== null && score < 50) return "high";
  if (score !== null && score < 70) return "medium";
  return "optimization";
}

function prioritizedFindings(audit) {
  const groups = { high: [], medium: [], optimization: [] };
  for (const finding of audit.findings || []) {
    groups[priorityForFinding(audit, finding)].push(finding);
  }

  if (!groups.high.length && !groups.medium.length && !groups.optimization.length) {
    const weakest = scoreRows(audit)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .slice(0, 5);
    for (const [label, score] of weakest) {
      const key = score < 50 ? "high" : score < 70 ? "medium" : "optimization";
      groups[key].push({
        area: label.toLowerCase().replaceAll(" ", "_"),
        finding: label + " scored " + score + "/100.",
        businessImplication: "This area may deserve review as part of the website improvement plan.",
        evidence: []
      });
    }
  }

  return groups;
}

function topOpportunities(audit, limit = 3) {
  const groups = prioritizedFindings(audit);
  return [...groups.high, ...groups.medium, ...groups.optimization].slice(0, limit);
}

function assessmentText(score) {
  const value = scoreValue(score);
  if (value === null) return "Measured opportunities identified";
  if (value < 45) return "Significant modernization opportunity";
  if (value < 65) return "Good potential with clear opportunities";
  if (value < 80) return "Solid foundation with targeted improvements";
  return "Strong foundation with optimization opportunities";
}

function executiveSummary(audit) {
  const opportunities = topOpportunities(audit, 3)
    .map((item) => item.finding)
    .filter(Boolean);

  const score = scoreValue(audit.websiteHealthScore);
  const opening = score === null
    ? "The audit identified measurable opportunities across the site's content, structure, conversion experience and technical presentation."
    : "The website scored " + score + "/100 for overall Website Health. " + assessmentText(score) + ".";

  return opening + (opportunities.length
    ? " The most important findings include " + opportunities.join(" ")
    : " The recommendations below focus on the most actionable measured improvements.");
}

async function getLogoBuffer() {
  if (!logoPromise) {
    logoPromise = fetch(WSP_REPORT_LOGO_URL, {
      headers: { "User-Agent": "VIPWebsiteReport/1.0" }
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Logo download failed.");
        return Buffer.from(await response.arrayBuffer());
      })
      .catch(() => null);
  }
  return logoPromise;
}

function htmlScoreCard(label, value) {
  const score = scoreValue(value);
  if (score === null) return "";
  const tone = scoreTone(score);
  return `
    <div class="score-card">
      <div class="score-label">${esc(label)}</div>
      <div class="score-number" style="color:${tone.color}">${score}</div>
      <div class="score-bar"><span style="width:${score}%;background:${tone.color}"></span></div>
    </div>`;
}

function htmlFinding(finding, priority) {
  const evidence = (finding.evidence || []).slice(0, 3).map((item) => `
    <li>${esc(item.fact || "Supporting evidence")}<br><span>${esc(shortUrl(item.url))}</span></li>`).join("");
  return `
    <article class="finding ${priority}">
      <div class="finding-title">${esc(finding.finding || "Website opportunity")}</div>
      ${finding.businessImplication ? `<p>${esc(finding.businessImplication)}</p>` : ""}
      ${evidence ? `<ul>${evidence}</ul>` : ""}
    </article>`;
}

export function buildClientReportHtml(audit) {
  const groups = prioritizedFindings(audit);
  const overall = scoreValue(audit.websiteHealthScore);
  const overallTone = scoreTone(overall);
  const scores = scoreRows(audit);
  const opportunities = topOpportunities(audit, 3);
  const cms = audit.platform?.cmsDetected || "Not publicly determined";
  const cmsVersion = audit.platform?.cmsVersionDetected || null;
  const pageRows = (audit.pages || []).slice(0, 15).map((page) => `
    <tr>
      <td>${esc(page.pageType || "page")}</td>
      <td>${esc(page.title || shortUrl(page.url))}</td>
      <td>${page.httpStatus ?? "-"}</td>
      <td>${page.contentQualityScore ?? "-"}</td>
      <td>${page.conversionScore ?? "-"}</td>
      <td>${page.technicalSeoScore ?? "-"}</td>
    </tr>`).join("");

  const opportunityList = opportunities.map((item, index) =>
    `<li><strong>${index + 1}.</strong> ${esc(item.finding || "Website improvement opportunity")}</li>`
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Website Intelligence Report - ${esc(audit.companyName)}</title>
<style>
:root{--navy:${BRAND.navy};--blue:${BRAND.blue};--cyan:${BRAND.cyan};--ink:${BRAND.ink};--muted:${BRAND.muted};--line:${BRAND.line};--soft:${BRAND.lightBlue}}
*{box-sizing:border-box} body{margin:0;background:#edf3f8;color:var(--ink);font-family:Arial,Helvetica,sans-serif;line-height:1.45}.toolbar{position:sticky;top:0;z-index:20;display:flex;gap:10px;justify-content:center;padding:12px;background:#071f46}.toolbar button,.toolbar a{border:0;border-radius:8px;padding:10px 14px;background:#fff;color:#0b3c76;text-decoration:none;font-weight:700;cursor:pointer}.report{width:8.5in;max-width:100%;margin:20px auto;background:#fff;box-shadow:0 8px 30px rgba(14,44,77,.13)}.page{min-height:11in;padding:.55in .58in;position:relative;page-break-after:always}.page:last-child{page-break-after:auto}.brand{display:flex;justify-content:space-between;align-items:flex-start;gap:30px;border-bottom:3px solid #43a7df;padding-bottom:15px}.brand img{width:250px;max-height:82px;object-fit:contain;object-position:left top}.brand-note{text-align:right;color:#52739c;font-size:12px;letter-spacing:2px;text-transform:uppercase}.kicker{margin-top:42px;color:#6080a5;font-size:17px}.title{font-size:36px;line-height:1.06;color:var(--navy);margin:4px 0}.subtitle{font-size:21px;color:#6680a3;margin-bottom:28px}.client{font-size:20px;font-weight:700}.meta{color:#526f93}.hero{display:grid;grid-template-columns:190px 1fr;gap:28px;background:linear-gradient(135deg,#0f4380,#1d82c8);color:#fff;border-radius:18px;padding:22px;margin:28px 0}.health{text-align:center;border-right:1px solid rgba(255,255,255,.45)}.health .number{font-size:56px;font-weight:800}.health small{display:block;letter-spacing:1.5px}.assessment h2{font-size:27px;margin:8px 0}.assessment p{margin:0;color:#eaf6ff}.section-title{font-size:23px;color:var(--navy);margin:26px 0 12px}.summary{font-size:15px;color:#35567c}.scores{display:grid;grid-template-columns:repeat(4,1fr);gap:11px}.score-card{border:1px solid var(--line);border-radius:12px;padding:12px;background:linear-gradient(#fff,#f7fbfe)}.score-label{font-size:11px;font-weight:700;min-height:32px}.score-number{font-size:30px;font-weight:800}.score-bar{height:6px;background:#dfe8ef;border-radius:10px;overflow:hidden}.score-bar span{display:block;height:100%;border-radius:10px}.opportunities{background:#eef7fd;border-radius:12px;padding:14px 18px}.opportunities li{margin:7px 0}.snapshot{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.snapshot div{background:#f4f9fc;border:1px solid #dceaf4;border-radius:10px;padding:10px}.snapshot strong{display:block;color:var(--navy);font-size:18px}.snapshot span{font-size:10px;color:#67809d}.finding{border-radius:12px;padding:15px 17px;margin:12px 0;border-left:6px solid}.finding.high{background:#fff1f0;border-color:#e54e47}.finding.medium{background:#fff8e8;border-color:#efa51e}.finding.optimization{background:#eef9f1;border-color:#38a864}.finding-title{font-weight:800;font-size:16px;color:#123b70}.finding p{margin:5px 0;color:#425f80}.finding ul{font-size:10px;color:#637b96;padding-left:18px}.finding li{margin:4px 0}.finding li span{color:#87a0b9}.priority-block{margin:20px 0}.priority-label{font-size:20px;font-weight:800}.roadmap{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}.roadmap div{padding:14px;border-radius:10px;background:#eff7fd;border:1px solid #d7e8f5}.roadmap strong{display:block;color:#0c4f94}.pages{width:100%;border-collapse:collapse;font-size:10px}.pages th,.pages td{text-align:left;border-bottom:1px solid #dce7ef;padding:7px 5px}.pages th{background:#eaf5fc;color:#174b81}.disclaimer{font-size:9px;color:#71869e;margin-top:20px}.footer{position:absolute;left:.58in;right:.58in;bottom:.32in;border-top:1px solid #d8e6f0;padding-top:8px;display:flex;justify-content:space-between;color:#557695;font-size:9px}.email-box{border:1px solid var(--line);border-radius:12px;padding:15px;background:#f8fbfd}.email-box pre{white-space:pre-wrap;font:13px Arial;margin:0;color:#274b71}
@media(max-width:760px){.report{margin:0}.page{min-height:auto;padding:24px}.hero{grid-template-columns:1fr}.health{border-right:0;border-bottom:1px solid rgba(255,255,255,.4);padding-bottom:15px}.scores{grid-template-columns:repeat(2,1fr)}.snapshot,.roadmap{grid-template-columns:1fr}.brand-note{display:none}}
@media print{body{background:#fff}.toolbar{display:none}.report{margin:0;box-shadow:none;width:auto}.page{width:8.5in;height:11in;overflow:hidden}.finding{break-inside:avoid}.score-card{break-inside:avoid}}
</style>
</head>
<body>
<div class="toolbar">
  <a href="/reports/website-intelligence/${encodeURIComponent(audit.id)}.pdf">Download PDF</a>
  <button onclick="window.print()">Print</button>
  <button onclick="copyEmail()">Copy Email</button>
  <button onclick="openEmail()">Open Email Draft</button>
</div>
<div class="report">
<section class="page">
  <div class="brand"><img src="${esc(WSP_REPORT_LOGO_URL)}" alt="Web Search Professionals"><div class="brand-note">Website Intelligence<br>Data. Insight. Opportunity.</div></div>
  <div class="kicker">Website Audit &amp; Growth Opportunities</div>
  <h1 class="title">Website Intelligence Report</h1>
  <div class="subtitle">Prepared for ${esc(audit.companyName)}</div>
  <div class="client">${esc(audit.companyName)}</div>
  <div class="meta">${esc(audit.website)} &nbsp;•&nbsp; Audit Date: ${esc(formatDate(audit.auditedAt))}</div>
  <div class="hero">
    <div class="health"><small>WEBSITE HEALTH</small><div class="number">${overall ?? "-"}<span style="font-size:24px;font-weight:400">/100</span></div><div>${esc(overallTone.label)}</div></div>
    <div class="assessment"><small>OVERALL ASSESSMENT</small><h2>${esc(assessmentText(overall))}</h2><p>${esc(executiveSummary(audit))}</p></div>
  </div>
  <h2 class="section-title">Website Scorecard</h2>
  <div class="scores">${scores.slice(0,8).map(([label,value]) => htmlScoreCard(label,value)).join("")}</div>
  <h2 class="section-title">Top Opportunities</h2>
  <ol class="opportunities">${opportunityList || "<li>Continue monitoring and optimizing the site's strongest opportunities.</li>"}</ol>
  <div class="footer"><span>Prepared by Web Search Professionals</span><span>web-search-pros.com</span></div>
</section>
<section class="page">
  <div class="brand"><img src="${esc(WSP_REPORT_LOGO_URL)}" alt="Web Search Professionals"><div class="brand-note">Detailed Scorecard<br>&amp; Findings</div></div>
  <h1 class="section-title">Audit Snapshot</h1>
  <div class="snapshot">
    <div><strong>${Number(audit.pagesSampled || 0)}</strong><span>PAGES ANALYZED</span></div>
    <div><strong>${Number(audit.auditConfidence || 0)}%</strong><span>AUDIT CONFIDENCE</span></div>
    <div><strong>${esc(cms)}</strong><span>CMS DETECTED</span></div>
    <div><strong>${audit.pageSpeedAvailable ? "Available" : "Not included"}</strong><span>PAGESPEED DATA</span></div>
  </div>
  ${cmsVersion ? `<p class="summary"><strong>Detected CMS version:</strong> ${esc(cmsVersion)}. This is a publicly observable version signal only; update currency is not independently verified.</p>` : ""}
  <h2 class="section-title">Complete Scorecard</h2>
  <div class="scores">${scores.map(([label,value]) => htmlScoreCard(label,value)).join("")}</div>
  <h2 class="section-title">Key Findings</h2>
  ${[...groups.high,...groups.medium,...groups.optimization].slice(0,6).map((f) => htmlFinding(f,priorityForFinding(audit,f))).join("")}
  <div class="footer"><span>Website Intelligence - Evidence-based public website analysis</span><span>web-search-pros.com</span></div>
</section>
<section class="page">
  <div class="brand"><img src="${esc(WSP_REPORT_LOGO_URL)}" alt="Web Search Professionals"><div class="brand-note">Priority Recommendations<br>&amp; Next Steps</div></div>
  <div class="priority-block"><div class="priority-label" style="color:${BRAND.red}">High Priority</div>${groups.high.slice(0,4).map((f)=>htmlFinding(f,"high")).join("") || '<p class="summary">No high-priority findings were generated from the measured data.</p>'}</div>
  <div class="priority-block"><div class="priority-label" style="color:${BRAND.orange}">Medium Priority</div>${groups.medium.slice(0,4).map((f)=>htmlFinding(f,"medium")).join("") || '<p class="summary">No medium-priority findings were generated from the measured data.</p>'}</div>
  <div class="priority-block"><div class="priority-label" style="color:${BRAND.green}">Optimization</div>${groups.optimization.slice(0,4).map((f)=>htmlFinding(f,"optimization")).join("") || '<p class="summary">Continue monitoring strong areas for incremental improvement.</p>'}</div>
  <h2 class="section-title">90-Day Roadmap</h2>
  <div class="roadmap"><div><strong>Days 1-30</strong>Confirm priority findings, correct quick technical issues, and remove obvious conversion friction.</div><div><strong>Days 31-60</strong>Improve content, service-page journeys, calls to action, trust signals and structured information.</div><div><strong>Days 61-90</strong>Measure impact, deepen SEO/schema improvements, and strengthen AI/search discoverability.</div></div>
  <p class="disclaimer">This report is based on publicly observable website information and automated measurements. It is not a security audit, legal accessibility determination, or guarantee of search or business performance. Technology versions are reported only when publicly detectable.</p>
  <div class="footer"><span>Prepared by Web Search Professionals</span><span>web-search-pros.com</span></div>
</section>
${pageRows ? `<section class="page"><div class="brand"><img src="${esc(WSP_REPORT_LOGO_URL)}" alt="Web Search Professionals"><div class="brand-note">Evidence Appendix</div></div><h1 class="section-title">Sampled Pages</h1><p class="summary">The following sampled pages support the site-level findings. Page scores are diagnostic measurements used to identify improvement opportunities.</p><table class="pages"><thead><tr><th>Type</th><th>Page</th><th>HTTP</th><th>Content</th><th>Conversion</th><th>SEO</th></tr></thead><tbody>${pageRows}</tbody></table><div class="footer"><span>Website Intelligence Evidence Appendix</span><span>web-search-pros.com</span></div></section>` : ""}
</div>
<script>
const emailDraft=${JSON.stringify(buildReportEmailDraft(audit))};
async function copyEmail(){const text='Subject: '+emailDraft.subject+'\n\n'+emailDraft.body;try{await navigator.clipboard.writeText(text);alert('Email draft copied.');}catch{alert('Copy failed.');}}
function openEmail(){const href='mailto:?subject='+encodeURIComponent(emailDraft.subject)+'&body='+encodeURIComponent(emailDraft.body+'\n\nPDF report: download it from the report page and attach it before sending.');window.location.href=href;}
</script>
</body></html>`;
}

function pdfHeader(doc, logo) {
  if (logo) {
    try { doc.image(logo, 42, 34, { width: 220 }); } catch {}
  } else {
    doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(19).text("WEB SEARCH PROFESSIONALS", 42, 45);
  }
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text("WEBSITE INTELLIGENCE", 410, 42, { width: 140, align: "right" });
  doc.strokeColor(BRAND.cyan).lineWidth(2).moveTo(42, 112).lineTo(570, 112).stroke();
}

function pdfFooter(doc, pageLabel = "Website Intelligence") {
  const y = 756;
  doc.strokeColor(BRAND.line).lineWidth(1).moveTo(42, y).lineTo(570, y).stroke();
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(7).text(pageLabel, 42, y + 8);
  doc.text("web-search-pros.com", 420, y + 8, { width: 150, align: "right" });
}

function pdfSectionTitle(doc, text, y) {
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(17).text(text, 42, y);
  return doc.y + 7;
}

function pdfScoreCards(doc, audit, startY) {
  const rows = scoreRows(audit);
  const width = 122;
  const gap = 10;
  let y = startY;
  rows.slice(0, 8).forEach(([label, value], index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = 42 + col * (width + gap);
    const boxY = y + row * 82;
    const score = scoreValue(value);
    const tone = scoreTone(score);
    doc.roundedRect(x, boxY, width, 68, 7).fillAndStroke("#f8fbfd", BRAND.line);
    doc.fillColor(BRAND.ink).font("Helvetica-Bold").fontSize(8).text(label, x + 9, boxY + 9, { width: width - 18 });
    doc.fillColor(tone.color).font("Helvetica-Bold").fontSize(23).text(String(score), x + 9, boxY + 30);
    doc.roundedRect(x + 46, boxY + 48, width - 57, 5, 2).fill("#dfe8ef");
    doc.roundedRect(x + 46, boxY + 48, (width - 57) * score / 100, 5, 2).fill(tone.color);
  });
  return y + Math.ceil(Math.min(rows.length, 8) / 4) * 82;
}

function pdfFinding(doc, finding, priority, y) {
  const colors = {
    high: { fill: "#fff1f0", stroke: BRAND.red },
    medium: { fill: "#fff8e8", stroke: BRAND.orange },
    optimization: { fill: "#eef9f1", stroke: BRAND.green }
  };
  const color = colors[priority];
  const title = String(finding.finding || "Website opportunity").slice(0, 220);
  const implication = String(finding.businessImplication || "").slice(0, 400);
  const height = implication ? 72 : 50;
  if (y + height > 735) return { y, overflow: true };
  doc.roundedRect(42, y, 528, height, 6).fillAndStroke(color.fill, color.stroke);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(10).text(title, 55, y + 10, { width: 500 });
  if (implication) doc.fillColor(BRAND.ink).font("Helvetica").fontSize(8).text(implication, 55, doc.y + 5, { width: 500, height: 35, ellipsis: true });
  return { y: y + height + 8, overflow: false };
}

export async function streamClientReportPdf(audit, res) {
  const logo = await getLogoBuffer();
  const doc = new PDFDocument({ size: "LETTER", margin: 42, info: {
    Title: "Website Intelligence Report - " + audit.companyName,
    Author: "Web Search Professionals",
    Subject: "Website Intelligence Audit"
  }});
  doc.pipe(res);

  const overall = scoreValue(audit.websiteHealthScore);
  const overallTone = scoreTone(overall);
  const groups = prioritizedFindings(audit);

  pdfHeader(doc, logo);
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(12).text("Website Audit & Growth Opportunities", 42, 145);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(28).text("Website Intelligence Report", 42, 166);
  doc.fillColor(BRAND.ink).font("Helvetica-Bold").fontSize(15).text(audit.companyName, 42, 216);
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(9).text(audit.website + "  |  Audit Date: " + formatDate(audit.auditedAt), 42, 238);

  doc.roundedRect(42, 274, 528, 154, 12).fill(BRAND.navy);
  doc.fillColor(BRAND.white).font("Helvetica").fontSize(9).text("WEBSITE HEALTH", 64, 296);
  doc.font("Helvetica-Bold").fontSize(43).text(String(overall ?? "-"), 64, 318, { width: 110 });
  doc.font("Helvetica").fontSize(18).text("/100", 127, 337);
  doc.font("Helvetica-Bold").fontSize(11).text(overallTone.label, 64, 379, { width: 130 });
  doc.strokeColor("#83bde6").lineWidth(1).moveTo(214, 292).lineTo(214, 410).stroke();
  doc.fillColor("#a9d8f5").font("Helvetica").fontSize(8).text("OVERALL ASSESSMENT", 240, 296);
  doc.fillColor(BRAND.white).font("Helvetica-Bold").fontSize(19).text(assessmentText(overall), 240, 318, { width: 300 });
  doc.fillColor("#e8f5ff").font("Helvetica").fontSize(9).text(executiveSummary(audit), 240, 355, { width: 300, height: 55, ellipsis: true });

  let y = pdfSectionTitle(doc, "Website Scorecard", 458);
  y = pdfScoreCards(doc, audit, y);
  y = pdfSectionTitle(doc, "Top Opportunities", y + 2);
  for (const finding of topOpportunities(audit, 3)) {
    doc.fillColor(BRAND.ink).font("Helvetica").fontSize(9).text("• " + finding.finding, 55, y, { width: 500, height: 24, ellipsis: true });
    y = doc.y + 3;
  }
  pdfFooter(doc, "Prepared by Web Search Professionals");

  doc.addPage();
  pdfHeader(doc, logo);
  y = pdfSectionTitle(doc, "Detailed Scorecard & Findings", 145);
  doc.fillColor(BRAND.ink).font("Helvetica").fontSize(9).text(
    "Pages analyzed: " + Number(audit.pagesSampled || 0) +
    "   |   Audit confidence: " + Number(audit.auditConfidence || 0) + "%" +
    "   |   CMS: " + (audit.platform?.cmsDetected || "Not publicly determined"),
    42, y, { width: 528 }
  );
  y = doc.y + 16;
  y = pdfScoreCards(doc, audit, y);
  y = pdfSectionTitle(doc, "Key Findings", y + 3);
  for (const finding of [...groups.high, ...groups.medium, ...groups.optimization].slice(0, 6)) {
    const result = pdfFinding(doc, finding, priorityForFinding(audit, finding), y);
    if (result.overflow) break;
    y = result.y;
  }
  pdfFooter(doc, "Website Intelligence - Public website analysis");

  doc.addPage();
  pdfHeader(doc, logo);
  y = pdfSectionTitle(doc, "Priority Recommendations & Next Steps", 145);
  const groupInfo = [
    ["High Priority", "high", BRAND.red],
    ["Medium Priority", "medium", BRAND.orange],
    ["Optimization", "optimization", BRAND.green]
  ];
  for (const [label, key, color] of groupInfo) {
    if (y > 670) break;
    doc.fillColor(color).font("Helvetica-Bold").fontSize(14).text(label, 42, y);
    y = doc.y + 7;
    const list = groups[key].slice(0, 3);
    if (!list.length) {
      doc.fillColor(BRAND.muted).font("Helvetica").fontSize(9).text(
        key === "optimization" ? "Continue monitoring strong areas for incremental improvement." : "No findings in this priority level.",
        55, y, { width: 500 }
      );
      y = doc.y + 10;
    } else {
      for (const finding of list) {
        const result = pdfFinding(doc, finding, key, y);
        if (result.overflow) break;
        y = result.y;
      }
    }
  }
  if (y < 650) {
    y = pdfSectionTitle(doc, "90-Day Roadmap", y + 5);
    const steps = [
      ["Days 1-30", "Confirm priorities, address quick technical fixes, and remove obvious conversion friction."],
      ["Days 31-60", "Strengthen content, service-page journeys, calls to action, trust signals and structured information."],
      ["Days 61-90", "Measure impact and deepen SEO, schema, performance and AI/search discoverability improvements."]
    ];
    steps.forEach(([label, text], index) => {
      const x = 42 + index * 176;
      doc.roundedRect(x, y, 166, 76, 7).fillAndStroke("#eef7fd", BRAND.line);
      doc.fillColor(BRAND.blue).font("Helvetica-Bold").fontSize(10).text(label, x + 10, y + 10);
      doc.fillColor(BRAND.ink).font("Helvetica").fontSize(8).text(text, x + 10, y + 28, { width: 146, height: 40, ellipsis: true });
    });
  }
  doc.fillColor(BRAND.muted).font("Helvetica").fontSize(6.8).text(
    "This report is based on publicly observable website information and automated measurements. It is not a security audit, legal accessibility determination, or guarantee of search or business performance. Technology versions are reported only when publicly detectable.",
    42, 714, { width: 528 }
  );
  pdfFooter(doc, "Prepared by Web Search Professionals");

  if ((audit.pages || []).length) {
    doc.addPage();
    pdfHeader(doc, logo);
    y = pdfSectionTitle(doc, "Evidence Appendix - Sampled Pages", 145);
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text(
      "Page-level measurements supporting the Website Intelligence scorecard.",
      42, y, { width: 528 }
    );
    y = doc.y + 13;
    doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(7.5);
    doc.text("PAGE", 42, y, { width: 270 });
    doc.text("TYPE", 315, y, { width: 70 });
    doc.text("HTTP", 390, y, { width: 40 });
    doc.text("CONTENT", 435, y, { width: 45 });
    doc.text("CONV.", 485, y, { width: 40 });
    doc.text("SEO", 532, y, { width: 38 });
    y += 14;
    doc.strokeColor(BRAND.line).moveTo(42, y).lineTo(570, y).stroke();
    y += 5;
    for (const page of audit.pages.slice(0, 15)) {
      if (y > 724) break;
      doc.fillColor(BRAND.ink).font("Helvetica").fontSize(7).text(
        String(page.title || shortUrl(page.url)).slice(0, 70), 42, y, { width: 265, height: 20, ellipsis: true }
      );
      doc.text(String(page.pageType || "page").slice(0, 18), 315, y, { width: 70 });
      doc.text(String(page.httpStatus ?? "-"), 390, y, { width: 40 });
      doc.text(String(page.contentQualityScore ?? "-"), 435, y, { width: 45 });
      doc.text(String(page.conversionScore ?? "-"), 485, y, { width: 40 });
      doc.text(String(page.technicalSeoScore ?? "-"), 532, y, { width: 38 });
      y += 24;
      doc.strokeColor("#e4edf4").moveTo(42, y - 4).lineTo(570, y - 4).stroke();
    }
    pdfFooter(doc, "Website Intelligence Evidence Appendix");
  }

  doc.end();
}

export function buildReportEmailDraft(audit) {
  const top = topOpportunities(audit, 2).map((item) => item.finding).filter(Boolean);
  const firstNamePlaceholder = "Hi,";
  const body = [
    firstNamePlaceholder,
    "",
    "I took a look at the public-facing website for " + audit.companyName + " and put together a short Website Intelligence Report.",
    top.length ? "A couple of things that stood out were: " + top.join(" ") : "It highlights a few measurable areas that may be worth reviewing.",
    "",
    "I've attached the report so you can see the scorecard, supporting findings, and a practical 90-day improvement path.",
    "",
    "If it would be useful, I'd be happy to walk through the findings with you.",
    "",
    "Rudy McCormick",
    "Web Search Professionals",
    "web-search-pros.com"
  ].join("\n");

  return {
    subject: "Website Intelligence Report for " + audit.companyName,
    body
  };
}

export function reportFilename(audit) {
  const base = String(audit.companyName || "website")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "website";
  return base + "-website-intelligence-report.pdf";
}

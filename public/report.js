(() => {
  const LOGO_URL = "https://www.web-search-pros.com/wp-content/uploads/2017/03/Logo_Small-1-300x98.png";
  const audits = new Map();
  const prospects = new Map();
  let scanTimer = null;

  const esc = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const score = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  };

  const hostKey = (value) => {
    try {
      return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return String(value || "").toLowerCase().replace(/^www\./, "");
    }
  };

  const shortUrl = (value) => {
    try {
      const url = new URL(value);
      return url.hostname.replace(/^www\./, "") + (url.pathname === "/" ? "" : url.pathname);
    } catch {
      return String(value || "");
    }
  };

  const dateLabel = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "Not available";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(date);
  };

  const tone = (value) => {
    const n = score(value);
    if (n === null) return { label: "Not measured", color: "#607a9c" };
    if (n < 50) return { label: "Priority opportunity", color: "#d83c3c" };
    if (n < 70) return { label: "Improvement opportunity", color: "#ee9b12" };
    return { label: "Solid foundation", color: "#31a561" };
  };

  const scoreRows = (audit) => {
    const s = audit?.scores || {};
    return [
      ["Content Freshness", s.contentFreshness],
      ["Site Structure", s.siteStructure],
      ["Conversion", s.conversion],
      ["Technical SEO", s.technicalSeo],
      ["Performance", s.performance],
      ["Mobile", s.mobile],
      ["Accessibility", s.accessibility],
      ["Structured Data", s.structuredData],
      ["Platform Health", s.platformHealth],
      ["Trust", s.trust],
      ["AI Discoverability", s.aiDiscoverability]
    ].filter(([, value]) => score(value) !== null);
  };

  const areaScore = (audit, area) => {
    const s = audit?.scores || {};
    const map = {
      content_freshness: s.contentFreshness,
      site_structure: s.siteStructure,
      conversion: s.conversion,
      technical_seo: s.technicalSeo,
      performance: s.performance,
      mobile: s.mobile,
      accessibility: s.accessibility,
      structured_data: s.structuredData,
      platform_health: s.platformHealth,
      site_hygiene: s.platformHealth,
      trust: s.trust,
      ai_discoverability: s.aiDiscoverability
    };
    return score(map[area]);
  };

  const priority = (audit, finding) => {
    const explicit = String(finding?.severity || "").toLowerCase();
    if (["critical", "high"].includes(explicit)) return "high";
    if (["medium", "moderate"].includes(explicit)) return "medium";
    if (["low", "info", "informational"].includes(explicit)) return "optimization";
    const n = areaScore(audit, finding?.area);
    if (n !== null && n < 50) return "high";
    if (n !== null && n < 70) return "medium";
    return "optimization";
  };

  const groupsFor = (audit) => {
    const groups = { high: [], medium: [], optimization: [] };
    for (const finding of audit?.findings || []) {
      groups[priority(audit, finding)].push(finding);
    }
    if (!groups.high.length && !groups.medium.length && !groups.optimization.length) {
      for (const [label, value] of scoreRows(audit).sort((a, b) => Number(a[1]) - Number(b[1])).slice(0, 5)) {
        const key = Number(value) < 50 ? "high" : Number(value) < 70 ? "medium" : "optimization";
        groups[key].push({
          area: label.toLowerCase().replaceAll(" ", "_"),
          finding: label + " scored " + value + "/100.",
          businessImplication: "This area may deserve review as part of the website improvement plan.",
          evidence: []
        });
      }
    }
    return groups;
  };

  const topFindings = (audit, limit = 3) => {
    const groups = groupsFor(audit);
    return [...groups.high, ...groups.medium, ...groups.optimization].slice(0, limit);
  };

  const assessment = (value) => {
    const n = score(value);
    if (n === null) return "Measured opportunities identified";
    if (n < 45) return "Significant modernization opportunity";
    if (n < 65) return "Good potential with clear opportunities";
    if (n < 80) return "Solid foundation with targeted improvements";
    return "Strong foundation with optimization opportunities";
  };

  const summary = (audit) => {
    const n = score(audit?.websiteHealthScore);
    const opening = n === null
      ? "The audit identified measurable opportunities across the site's content, structure, conversion experience and technical presentation."
      : "The website scored " + n + "/100 for overall Website Health. " + assessment(n) + ".";
    const items = topFindings(audit, 2).map((item) => item.finding).filter(Boolean);
    return opening + (items.length ? " Key findings include " + items.join(" ") : "");
  };

  const scoreCard = (label, value) => {
    const n = score(value);
    if (n === null) return "";
    const t = tone(n);
    return `<div class="wir-score"><small>${esc(label)}</small><strong style="color:${t.color}">${n}</strong><div><span style="width:${n}%;background:${t.color}"></span></div></div>`;
  };

  const findingCard = (audit, finding) => {
    const p = priority(audit, finding);
    const evidence = (finding?.evidence || []).slice(0, 2).map((item) =>
      `<li>${esc(item.fact || "Supporting evidence")}<br><span>${esc(shortUrl(item.url))}</span></li>`
    ).join("");
    return `<article class="wir-finding ${p}"><h4>${esc(finding?.finding || "Website opportunity")}</h4>${finding?.businessImplication ? `<p>${esc(finding.businessImplication)}</p>` : ""}${evidence ? `<ul>${evidence}</ul>` : ""}</article>`;
  };

  const emailDraft = (audit) => {
    const top = topFindings(audit, 2).map((item) => item.finding).filter(Boolean);
    return {
      subject: "Website Intelligence Report for " + audit.companyName,
      body: [
        "Hi,",
        "",
        "I took a look at the public-facing website for " + audit.companyName + " and put together a short Website Intelligence Report.",
        top.length ? "A couple of things that stood out were: " + top.join(" ") : "It highlights several measurable areas that may be worth reviewing.",
        "",
        "I've attached the report so you can see the scorecard, supporting findings, and a practical 90-day improvement path.",
        "",
        "If it would be useful, I'd be happy to walk through the findings with you.",
        "",
        "Rudy McCormick",
        "Web Search Professionals",
        "web-search-pros.com"
      ].join("\n")
    };
  };

  const reportHtml = (audit) => {
    const groups = groupsFor(audit);
    const rows = scoreRows(audit);
    const overall = score(audit.websiteHealthScore);
    const overallTone = tone(overall);
    const top = topFindings(audit, 3);
    const cms = audit?.platform?.cmsDetected || "Not publicly determined";
    const cmsVersion = audit?.platform?.cmsVersionDetected || null;
    const scoreGrid = rows.map(([label, value]) => scoreCard(label, value)).join("");
    const topList = top.map((item, i) => `<li><b>${i + 1}.</b> ${esc(item.finding || "Website improvement opportunity")}</li>`).join("");
    return `
      <section class="wir-page">
        <header class="wir-brand"><img src="${LOGO_URL}" alt="Web Search Professionals"><div>WEBSITE INTELLIGENCE<br><span>DATA • INSIGHT • OPPORTUNITY</span></div></header>
        <p class="wir-kicker">Website Audit &amp; Growth Opportunities</p>
        <h1>Website Intelligence Report</h1>
        <h2>${esc(audit.companyName)}</h2>
        <p class="wir-meta">${esc(audit.website)} • Audit Date: ${esc(dateLabel(audit.auditedAt))}</p>
        <div class="wir-hero"><div class="wir-health"><small>WEBSITE HEALTH</small><strong>${overall ?? "-"}<span>/100</span></strong><em>${esc(overallTone.label)}</em></div><div><small>OVERALL ASSESSMENT</small><h3>${esc(assessment(overall))}</h3><p>${esc(summary(audit))}</p></div></div>
        <h3 class="wir-title">Website Scorecard</h3><div class="wir-scores">${rows.slice(0,8).map(([label,value])=>scoreCard(label,value)).join("")}</div>
        <h3 class="wir-title">Top Opportunities</h3><ol class="wir-top">${topList || "<li>Continue monitoring and optimizing the site's strongest opportunities.</li>"}</ol>
        <footer>Prepared by Web Search Professionals <span>web-search-pros.com</span></footer>
      </section>
      <section class="wir-page">
        <header class="wir-brand"><img src="${LOGO_URL}" alt="Web Search Professionals"><div>DETAILED SCORECARD<br><span>&amp; FINDINGS</span></div></header>
        <h1>Audit Snapshot</h1>
        <div class="wir-snapshot"><div><b>${Number(audit.pagesSampled || 0)}</b><span>Pages analyzed</span></div><div><b>${Number(audit.auditConfidence || 0)}%</b><span>Audit confidence</span></div><div><b>${esc(cms)}</b><span>CMS detected</span></div><div><b>${audit.pageSpeedAvailable ? "Available" : "Not included"}</b><span>PageSpeed data</span></div></div>
        ${cmsVersion ? `<p class="wir-note"><b>Detected CMS version:</b> ${esc(cmsVersion)}. This is a publicly observable signal only; update currency is not independently verified.</p>` : ""}
        <h3 class="wir-title">Complete Scorecard</h3><div class="wir-scores">${scoreGrid}</div>
        <h3 class="wir-title">Key Findings</h3>${[...groups.high,...groups.medium,...groups.optimization].slice(0,6).map((f)=>findingCard(audit,f)).join("")}
        <footer>Website Intelligence • Evidence-based public website analysis <span>web-search-pros.com</span></footer>
      </section>
      <section class="wir-page">
        <header class="wir-brand"><img src="${LOGO_URL}" alt="Web Search Professionals"><div>PRIORITY RECOMMENDATIONS<br><span>&amp; NEXT STEPS</span></div></header>
        <h3 class="wir-priority high">High Priority</h3>${groups.high.slice(0,4).map((f)=>findingCard(audit,f)).join("") || '<p class="wir-note">No high-priority findings were generated from the measured data.</p>'}
        <h3 class="wir-priority medium">Medium Priority</h3>${groups.medium.slice(0,4).map((f)=>findingCard(audit,f)).join("") || '<p class="wir-note">No medium-priority findings were generated from the measured data.</p>'}
        <h3 class="wir-priority optimization">Optimization</h3>${groups.optimization.slice(0,4).map((f)=>findingCard(audit,f)).join("") || '<p class="wir-note">Continue monitoring strong areas for incremental improvement.</p>'}
        <h3 class="wir-title">90-Day Roadmap</h3><div class="wir-roadmap"><div><b>Days 1–30</b><span>Confirm priorities, fix quick technical issues, and remove obvious conversion friction.</span></div><div><b>Days 31–60</b><span>Improve content, service-page journeys, calls to action, trust signals and structured information.</span></div><div><b>Days 61–90</b><span>Measure impact and deepen SEO, schema, performance and AI/search discoverability improvements.</span></div></div>
        <p class="wir-disclaimer">This report is based on publicly observable website information and automated measurements. It is not a security audit, legal accessibility determination, or guarantee of search or business performance. Technology versions are reported only when publicly detectable.</p>
        <footer>Prepared by Web Search Professionals <span>web-search-pros.com</span></footer>
      </section>`;
  };

  const styleText = `
    .wir-actions{margin:14px 0 4px;padding:12px;border:1px solid #d6e5f1;border-radius:12px;background:#f5faff}.wir-actions strong{display:block;color:#082b63;margin-bottom:8px}.wir-actions .wir-buttons{display:flex;flex-wrap:wrap;gap:7px}.wir-actions button{border:1px solid #bdd7e9;background:#fff;color:#0b4c86;border-radius:7px;padding:7px 9px;font:700 10px Arial;cursor:pointer}.wir-actions button:first-child{background:#0f5d9d;color:#fff;border-color:#0f5d9d}.wir-actions small{display:block;margin-top:7px;color:#607a9c;font-size:9px}
    .wir-overlay{position:fixed;inset:0;z-index:99999;background:rgba(4,24,52,.85);overflow:auto;padding:24px}.wir-modal{max-width:930px;margin:auto}.wir-toolbar{position:sticky;top:0;z-index:3;display:flex;gap:8px;flex-wrap:wrap;padding:10px;background:#082b63;border-radius:12px 12px 0 0}.wir-toolbar button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;cursor:pointer;background:#fff;color:#0b4c86}.wir-toolbar .wir-close{margin-left:auto;background:#d83c3c;color:#fff}.wir-report{background:#eaf1f7;padding:18px}.wir-page{position:relative;width:816px;min-height:1056px;margin:0 auto 18px;padding:52px;background:#fff;color:#15365f;font:14px/1.45 Arial,Helvetica,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.15)}.wir-page *{box-sizing:border-box}.wir-brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #31a7e0;padding-bottom:14px}.wir-brand img{width:245px;height:auto}.wir-brand div{text-align:right;color:#55779d;font-size:11px;letter-spacing:1.5px}.wir-brand span{font-size:9px}.wir-kicker{margin-top:35px;color:#6480a2;font-size:16px}.wir-page h1{margin:5px 0;color:#082b63;font-size:36px;line-height:1.05}.wir-page h2{margin:18px 0 3px;font-size:20px;color:#082b63}.wir-meta{color:#607a9c}.wir-hero{display:grid;grid-template-columns:190px 1fr;gap:28px;margin:26px 0;padding:22px;border-radius:18px;background:linear-gradient(135deg,#0b3f79,#1e83c9);color:#fff}.wir-health{border-right:1px solid rgba(255,255,255,.45);text-align:center}.wir-health small,.wir-hero>div>small{display:block;letter-spacing:1.6px}.wir-health strong{display:block;font-size:50px}.wir-health strong span{font-size:20px;font-weight:400}.wir-health em{font-style:normal;font-size:11px}.wir-hero h3{margin:8px 0;font-size:23px}.wir-hero p{color:#eaf6ff}.wir-title{margin:23px 0 10px;color:#082b63;font-size:21px}.wir-scores{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.wir-score{padding:11px;border:1px solid #d7e5f1;border-radius:10px;background:linear-gradient(#fff,#f7fbfe)}.wir-score small{display:block;min-height:30px;font-weight:700}.wir-score strong{font-size:28px}.wir-score>div{height:6px;border-radius:10px;background:#dfe8ef;overflow:hidden}.wir-score>div span{display:block;height:100%}.wir-top{padding:13px 20px;background:#eef7fd;border-radius:11px}.wir-top li{margin:6px 0}.wir-page footer{position:absolute;bottom:28px;left:52px;right:52px;padding-top:8px;border-top:1px solid #d8e6f0;color:#607a9c;font-size:9px}.wir-page footer span{float:right}.wir-snapshot{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.wir-snapshot div{padding:12px;border:1px solid #dceaf4;border-radius:10px;background:#f4f9fc}.wir-snapshot b{display:block;color:#082b63;font-size:19px}.wir-snapshot span{display:block;color:#67809d;font-size:10px}.wir-note{color:#536f91}.wir-finding{margin:10px 0;padding:13px 15px;border-left:6px solid;border-radius:10px}.wir-finding.high{background:#fff1f0;border-color:#d83c3c}.wir-finding.medium{background:#fff8e8;border-color:#ee9b12}.wir-finding.optimization{background:#eef9f1;border-color:#31a561}.wir-finding h4{margin:0;color:#123b70;font-size:15px}.wir-finding p{margin:5px 0;color:#425f80}.wir-finding ul{margin:5px 0;padding-left:18px;color:#637b96;font-size:10px}.wir-finding li span{color:#8ba0b7}.wir-priority{margin:22px 0 8px;font-size:20px}.wir-priority.high{color:#d83c3c}.wir-priority.medium{color:#d78a00}.wir-priority.optimization{color:#27884e}.wir-roadmap{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.wir-roadmap div{padding:12px;background:#eef7fd;border:1px solid #d7e5f1;border-radius:10px}.wir-roadmap b{display:block;color:#0b4c86}.wir-roadmap span{font-size:11px}.wir-disclaimer{margin-top:18px;color:#71869e;font-size:9px}.wir-toast{position:fixed;right:20px;bottom:20px;z-index:100000;padding:10px 14px;background:#082b63;color:#fff;border-radius:9px;box-shadow:0 4px 16px rgba(0,0,0,.2)}
    @media(max-width:860px){.wir-overlay{padding:0}.wir-modal{width:100%}.wir-report{padding:0}.wir-page{width:100%;min-height:0;margin:0;padding:28px}.wir-scores{grid-template-columns:repeat(2,1fr)}.wir-hero{grid-template-columns:1fr}.wir-health{border-right:0;border-bottom:1px solid rgba(255,255,255,.4);padding-bottom:12px}.wir-page footer{position:static;margin-top:28px}.wir-snapshot,.wir-roadmap{grid-template-columns:1fr}}
  `;

  const injectStyles = () => {
    if (document.querySelector("#wir-styles")) return;
    const style = document.createElement("style");
    style.id = "wir-styles";
    style.textContent = styleText;
    document.head.appendChild(style);
  };

  const toast = (message) => {
    const old = document.querySelector(".wir-toast");
    if (old) old.remove();
    const node = document.createElement("div");
    node.className = "wir-toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  };

  const captureAudit = (audit, context = {}) => {
    if (!audit || !audit.id) return;
    const key = hostKey(audit.website || context.website);
    if (!key) return;
    const merged = {
      ...audit,
      companyName: audit.companyName || context.companyName || "Website",
      website: audit.website || context.website || ""
    };
    audits.set(key, merged);
    prospects.set(key, { ...prospects.get(key), ...context });
    scheduleScan();
  };

  const capturePayload = (data) => {
    if (!data || typeof data !== "object") return;
    if (data.enrichment?.websiteAudit) {
      captureAudit(data.enrichment.websiteAudit, {
        companyName: data.enrichment.companyName,
        website: data.enrichment.website
      });
    }
    if (data.job?.items) {
      for (const item of data.job.items) {
        if (item.enrichment?.websiteAudit) {
          captureAudit(item.enrichment.websiteAudit, {
            companyName: item.company_name,
            website: item.website,
            email: item.contact_resolution?.primaryDecisionMaker?.publicBusinessEmail || ""
          });
        }
      }
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const clone = response.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        clone.json().then(capturePayload).catch(() => {});
      }
    } catch {}
    return response;
  };

  const filename = (audit) => (String(audit.companyName || "website")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "website") + "-website-intelligence-report.pdf";

  const logoData = async () => {
    try {
      const response = await originalFetch(LOGO_URL, { mode: "cors" });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const pdfText = (doc, text, x, y, width, options = {}) => {
    doc.text(String(text || ""), x, y, { maxWidth: width, ...options });
  };

  const makePdf = async (audit, save = true) => {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) {
      toast("PDF library has not loaded yet. Try again in a moment.");
      return null;
    }
    const doc = new JsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
    const navy = [8,43,99], blue = [24,121,189], muted = [96,122,156], line = [215,229,241], red = [216,60,60], orange = [238,155,18], green = [49,165,97];
    const logo = await logoData();
    const rows = scoreRows(audit);
    const groups = groupsFor(audit);
    const overall = score(audit.websiteHealthScore);

    const header = () => {
      if (logo) {
        try { doc.addImage(logo, "PNG", 42, 30, 220, 72, undefined, "FAST"); } catch {}
      } else {
        doc.setTextColor(...navy); doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.text("WEB SEARCH PROFESSIONALS",42,63);
      }
      doc.setTextColor(...muted); doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.text("WEBSITE INTELLIGENCE",570,46,{align:"right"});
      doc.setDrawColor(42,167,223); doc.setLineWidth(2); doc.line(42,110,570,110);
    };
    const footer = (label) => {
      doc.setDrawColor(...line); doc.setLineWidth(1); doc.line(42,752,570,752);
      doc.setFontSize(7); doc.setTextColor(...muted); doc.text(label,42,766); doc.text("web-search-pros.com",570,766,{align:"right"});
    };
    const section = (text,y) => { doc.setFont("helvetica","bold"); doc.setFontSize(17); doc.setTextColor(...navy); doc.text(text,42,y); return y+18; };
    const card = (label,value,x,y,w=122) => {
      const n=score(value); if(n===null)return;
      const c=n<50?red:n<70?orange:green;
      doc.setFillColor(248,251,253);doc.setDrawColor(...line);doc.roundedRect(x,y,w,68,7,7,"FD");
      doc.setTextColor(21,54,95);doc.setFont("helvetica","bold");doc.setFontSize(8);pdfText(doc,label,x+9,y+14,w-18);
      doc.setTextColor(...c);doc.setFontSize(23);doc.text(String(n),x+9,y+47);
      doc.setFillColor(223,232,239);doc.roundedRect(x+48,y+48,w-58,5,2,2,"F");doc.setFillColor(...c);doc.roundedRect(x+48,y+48,(w-58)*n/100,5,2,2,"F");
    };
    const findings = (items,y,colorKey,max=4) => {
      const cmap={high:red,medium:orange,optimization:green}; const c=cmap[colorKey];
      for(const item of items.slice(0,max)){
        if(y>690)break;
        doc.setFillColor(colorKey==="high"?255:colorKey==="medium"?255:238,colorKey==="high"?241:colorKey==="medium"?248:249,colorKey==="high"?240:colorKey==="medium"?232:241);
        doc.setDrawColor(...c);doc.roundedRect(42,y,528,58,6,6,"FD");
        doc.setTextColor(...navy);doc.setFont("helvetica","bold");doc.setFontSize(9);pdfText(doc,item.finding||"Website opportunity",55,y+15,500);
        doc.setTextColor(66,95,128);doc.setFont("helvetica","normal");doc.setFontSize(7.5);pdfText(doc,item.businessImplication||"",55,y+32,500);
        y+=66;
      }
      return y;
    };

    header();
    doc.setTextColor(...muted);doc.setFont("helvetica","normal");doc.setFontSize(12);doc.text("Website Audit & Growth Opportunities",42,145);
    doc.setTextColor(...navy);doc.setFont("helvetica","bold");doc.setFontSize(28);doc.text("Website Intelligence Report",42,178);
    doc.setFontSize(15);doc.text(String(audit.companyName||"Website"),42,215);
    doc.setTextColor(...muted);doc.setFont("helvetica","normal");doc.setFontSize(8.5);pdfText(doc,(audit.website||"")+"  |  Audit Date: "+dateLabel(audit.auditedAt),42,235,528);
    doc.setFillColor(...navy);doc.roundedRect(42,270,528,145,12,12,"F");
    doc.setTextColor(255,255,255);doc.setFontSize(8);doc.text("WEBSITE HEALTH",64,293);doc.setFont("helvetica","bold");doc.setFontSize(42);doc.text(String(overall??"-"),64,344);doc.setFont("helvetica","normal");doc.setFontSize(16);doc.text("/100",130,344);
    doc.setFont("helvetica","bold");doc.setFontSize(10);pdfText(doc,tone(overall).label,64,375,130);
    doc.setDrawColor(120,185,228);doc.line(212,288,212,400);doc.setTextColor(170,216,245);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.text("OVERALL ASSESSMENT",238,293);doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(17);pdfText(doc,assessment(overall),238,320,300);doc.setTextColor(232,245,255);doc.setFont("helvetica","normal");doc.setFontSize(8.5);pdfText(doc,summary(audit),238,352,300);
    let y=section("Website Scorecard",452);rows.slice(0,8).forEach(([l,v],i)=>card(l,v,42+(i%4)*132,y+Math.floor(i/4)*78));y+=Math.ceil(Math.min(rows.length,8)/4)*78;y=section("Top Opportunities",y+5);doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(21,54,95);for(const item of topFindings(audit,3)){pdfText(doc,"• "+(item.finding||"Website improvement opportunity"),55,y,500);y+=24;}footer("Prepared by Web Search Professionals");

    doc.addPage();header();y=section("Detailed Scorecard & Findings",145);doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(...muted);pdfText(doc,"Pages analyzed: "+Number(audit.pagesSampled||0)+"   |   Audit confidence: "+Number(audit.auditConfidence||0)+"%   |   CMS: "+(audit.platform?.cmsDetected||"Not publicly determined"),42,y,528);y+=28;rows.slice(0,8).forEach(([l,v],i)=>card(l,v,42+(i%4)*132,y+Math.floor(i/4)*78));y+=Math.ceil(Math.min(rows.length,8)/4)*78;y=section("Key Findings",y+5);y=findings([...groups.high,...groups.medium,...groups.optimization],y,"high",6);footer("Website Intelligence • Evidence-based public website analysis");

    doc.addPage();header();y=section("Priority Recommendations & Next Steps",145);const sets=[["High Priority","high",red],["Medium Priority","medium",orange],["Optimization","optimization",green]];for(const [label,key,c] of sets){if(y>650)break;doc.setTextColor(...c);doc.setFont("helvetica","bold");doc.setFontSize(13);doc.text(label,42,y);y+=12;y=findings(groups[key],y,key,3);}if(y<640){y=section("90-Day Roadmap",y+5);const steps=[["Days 1–30","Confirm priorities, fix quick technical issues, and remove obvious conversion friction."],["Days 31–60","Improve content, service-page journeys, calls to action, trust signals and structured information."],["Days 61–90","Measure impact and deepen SEO, schema, performance and AI/search discoverability improvements."]];steps.forEach(([l,t],i)=>{const x=42+i*176;doc.setFillColor(238,247,253);doc.setDrawColor(...line);doc.roundedRect(x,y,166,75,7,7,"FD");doc.setTextColor(...blue);doc.setFont("helvetica","bold");doc.setFontSize(9);doc.text(l,x+10,y+15);doc.setTextColor(21,54,95);doc.setFont("helvetica","normal");doc.setFontSize(7.5);pdfText(doc,t,x+10,y+31,146);});}doc.setTextColor(...muted);doc.setFont("helvetica","normal");doc.setFontSize(6.5);pdfText(doc,"This report is based on publicly observable website information and automated measurements. It is not a security audit, legal accessibility determination, or guarantee of search or business performance. Technology versions are reported only when publicly detectable.",42,716,528);footer("Prepared by Web Search Professionals");

    if(save)doc.save(filename(audit));
    return doc;
  };

  const preview = (audit) => {
    injectStyles();
    document.querySelector(".wir-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "wir-overlay";
    overlay.innerHTML = `<div class="wir-modal"><div class="wir-toolbar"><button data-wir-download>Download PDF</button><button data-wir-print>Print</button><button data-wir-email>Email Report</button><button data-wir-copy>Copy Email</button><button class="wir-close" data-wir-close>Close</button></div><div class="wir-report">${reportHtml(audit)}</div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-wir-close]").onclick=()=>overlay.remove();
    overlay.querySelector("[data-wir-download]").onclick=()=>makePdf(audit,true);
    overlay.querySelector("[data-wir-print]").onclick=()=>printReport(audit);
    overlay.querySelector("[data-wir-copy]").onclick=()=>copyEmail(audit);
    overlay.querySelector("[data-wir-email]").onclick=()=>emailReport(audit, prospectEmail(audit));
  };

  const printReport = (audit) => {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return toast("Allow pop-ups to print the report.");
    popup.document.write(`<!doctype html><html><head><title>${esc(audit.companyName)} Website Intelligence Report</title><style>${styleText}.wir-page{box-shadow:none;margin:0 auto;page-break-after:always}@media print{body{margin:0}.wir-page{width:8.5in;height:11in;overflow:hidden;page-break-after:always}}</style></head><body>${reportHtml(audit)}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
    popup.document.close();
  };

  const copyEmail = async (audit) => {
    const draft = emailDraft(audit);
    try {
      await navigator.clipboard.writeText("Subject: "+draft.subject+"\n\n"+draft.body);
      toast("Email draft copied.");
    } catch { toast("Could not copy the email draft."); }
  };

  const prospectEmail = (audit) => {
    const card = [...document.querySelectorAll(".prospect-card")].find((node) => hostKey(node.querySelector(".website-link")?.href) === hostKey(audit.website));
    return card?.querySelector('a[href^="mailto:"]')?.getAttribute("href")?.replace(/^mailto:/i, "") || prospects.get(hostKey(audit.website))?.email || "";
  };

  const emailReport = async (audit, email = "") => {
    await makePdf(audit, true);
    const draft = emailDraft(audit);
    toast("PDF downloaded. Attach it to the email before sending.");
    setTimeout(() => {
      location.href = "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent(draft.subject) + "&body=" + encodeURIComponent(draft.body + "\n\nThe PDF report has been downloaded and is ready to attach.");
    }, 450);
  };

  const injectActions = (card, audit) => {
    if (card.querySelector(".wir-actions")) return;
    const target = card.querySelector(".prospect-enrichment") || card;
    const box = document.createElement("div");
    box.className = "wir-actions";
    box.innerHTML = `<strong>Website Intelligence Report</strong><div class="wir-buttons"><button data-r="preview">Preview</button><button data-r="pdf">Download PDF</button><button data-r="print">Print</button><button data-r="email">Email Report</button></div><small>Client-facing report generated from the measured website audit. Internal prospect scoring is excluded.</small>`;
    target.parentNode.insertBefore(box, target.nextSibling);
    box.addEventListener("click", (event) => {
      const action = event.target.closest("[data-r]")?.dataset.r;
      if (!action) return;
      if (action === "preview") preview(audit);
      if (action === "pdf") makePdf(audit,true);
      if (action === "print") printReport(audit);
      if (action === "email") emailReport(audit, prospectEmail(audit));
    });
  };

  const scan = () => {
    injectStyles();
    for (const card of document.querySelectorAll(".prospect-card")) {
      const website = card.querySelector(".website-link")?.href;
      const audit = audits.get(hostKey(website));
      if (audit) injectActions(card, audit);
    }
  };

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 80);
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  window.WebsiteIntelligenceReports = { preview, downloadPdf: makePdf, print: printReport, email: emailReport, captureAudit };
  injectStyles();
})();

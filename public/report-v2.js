(() => {
  const LOGO_URL = "https://www.web-search-pros.com/wp-content/uploads/2017/03/Logo_Small-1-300x98.png";
  const audits = new Map();
  const prospects = new Map();
  let scanTimer = null;
  let logoCache = undefined;

  const C = {
    navy: [8, 43, 99],
    navy2: [12, 67, 124],
    blue: [34, 155, 218],
    blue2: [42, 121, 190],
    paleBlue: [235, 246, 253],
    line: [210, 228, 241],
    text: [25, 64, 112],
    muted: [91, 119, 157],
    red: [239, 68, 65],
    redSoft: [255, 239, 238],
    orange: [246, 166, 24],
    orangeSoft: [255, 247, 224],
    green: [48, 180, 103],
    greenSoft: [234, 249, 239],
    white: [255, 255, 255],
    veryLight: [248, 252, 255]
  };

  const esc = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const score = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? clamp(Math.round(number), 0, 100) : null;
  };

  const hostKey = (value) => {
    try {
      return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return String(value || "").toLowerCase().replace(/^www\./, "");
    }
  };

  const dateLabel = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric"
      }).format(new Date());
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(date);
  };

  const monthYear = (value) => {
    const date = value ? new Date(value) : null;
    const use = !date || Number.isNaN(date.getTime()) ? new Date() : date;
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric"
    }).format(use);
  };

  function colorForScore(value) {
    const n = score(value);
    if (n === null) return C.muted;
    if (n < 50) return C.red;
    if (n < 70) return C.orange;
    return C.green;
  }

  function toneForScore(value) {
    const n = score(value);
    if (n === null) return "Not fully measured";
    if (n < 45) return "Significant Opportunity";
    if (n < 65) return "Good Potential. Clear Opportunities.";
    if (n < 80) return "Solid Foundation. Targeted Opportunities.";
    return "Strong Foundation. Optimization Opportunities.";
  }

  function scoreRows(audit) {
    const s = audit?.scores || {};
    return [
      ["Content Freshness", s.contentFreshness, "DOC"],
      ["Site Structure", s.siteStructure, "MAP"],
      ["Conversion", s.conversion, "BAR"],
      ["Technical SEO", s.technicalSeo, "SEO"],
      ["Performance", s.performance, "SPD"],
      ["Platform Health", s.platformHealth, "DB"],
      ["Trust", s.trust, "SHD"],
      ["AI Discoverability", s.aiDiscoverability, "AI"]
    ].filter(([, value]) => score(value) !== null);
  }

  function executiveScores(audit) {
    const rows = scoreRows(audit);
    const wanted = [
      "Content Freshness",
      "Site Structure",
      "Conversion",
      "Technical SEO",
      "Platform Health",
      "Trust",
      "AI Discoverability"
    ];
    return wanted
      .map((label) => rows.find((row) => row[0] === label))
      .filter(Boolean);
  }

  function areaScore(audit, area) {
    const s = audit?.scores || {};
    const map = {
      content_freshness: s.contentFreshness,
      site_structure: s.siteStructure,
      conversion: s.conversion,
      conversion_architecture: s.conversion,
      technical_seo: s.technicalSeo,
      seo_content: s.technicalSeo,
      performance: s.performance,
      mobile: s.mobile,
      accessibility: s.accessibility,
      structured_data: s.structuredData,
      platform_health: s.platformHealth,
      site_hygiene: s.platformHealth,
      trust: s.trust,
      ai_discoverability: s.aiDiscoverability,
      ai_discovery: s.aiDiscoverability
    };
    return score(map[area]);
  }

  function priorityFor(audit, finding) {
    const explicit = String(finding?.severity || "").toLowerCase();
    if (["critical", "high"].includes(explicit)) return "high";
    if (["medium", "moderate"].includes(explicit)) return "medium";
    if (["low", "info", "informational"].includes(explicit)) return "optimization";
    const n = areaScore(audit, finding?.area);
    if (n !== null && n < 50) return "high";
    if (n !== null && n < 70) return "medium";
    return "optimization";
  }

  function fallbackFinding(label, value) {
    const n = score(value);
    const area = label.toLowerCase().replaceAll(" ", "_");
    const copy = {
      "Content Freshness": [
        "Refresh stale or aging content",
        "Review dated service, article, and news content so the site better reflects current expertise and priorities."
      ],
      "Site Structure": [
        "Strengthen site structure",
        "Improve important service paths, internal organization, and the clarity of how visitors move through the site."
      ],
      "Conversion": [
        "Strengthen conversion paths",
        "Use clearer service-specific next steps and reduce friction between interest and inquiry."
      ],
      "Technical SEO": [
        "Improve technical SEO foundations",
        "Tighten metadata, indexability, internal linking, and structured search signals."
      ],
      "Performance": [
        "Improve page performance",
        "Reduce avoidable front-end weight and performance friction where measurable."
      ],
      "Platform Health": [
        "Review platform modernization signals",
        "Review observable theme, framework, and front-end implementation signals for maintainability."
      ],
      "Trust": [
        "Expand trust-building content",
        "Strengthen proof, credentials, people, reviews, and other confidence-building signals near key decisions."
      ],
      "AI Discoverability": [
        "Enhance AI discoverability",
        "Clarify services, outcomes, business identity, and structured facts for machine-readable understanding."
      ]
    }[label] || [
      "Review " + label.toLowerCase(),
      "This measured area presents an opportunity for focused website improvement."
    ];

    return {
      area,
      severity: n !== null && n < 50 ? "high" : n !== null && n < 70 ? "medium" : "low",
      finding: copy[0],
      businessImplication: copy[1],
      evidence: []
    };
  }

  function groupsFor(audit) {
    const groups = { high: [], medium: [], optimization: [] };
    const seen = new Set();

    for (const finding of audit?.findings || []) {
      if (!finding?.finding) continue;
      const key = String(finding.finding).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      groups[priorityFor(audit, finding)].push(finding);
    }

    const sortedScores = scoreRows(audit)
      .slice()
      .sort((a, b) => Number(a[1]) - Number(b[1]));

    for (const [label, value] of sortedScores) {
      if (groups.high.length >= 3 && groups.medium.length >= 2 && groups.optimization.length >= 1) break;
      const generated = fallbackFinding(label, value);
      const p = priorityFor(audit, generated);
      if (groups[p].length >= (p === "high" ? 3 : p === "medium" ? 2 : 1)) continue;
      if ([...groups.high, ...groups.medium, ...groups.optimization]
        .some((item) => String(item.area) === generated.area)) continue;
      groups[p].push(generated);
    }

    return groups;
  }

  function topFindings(audit, limit = 3) {
    const groups = groupsFor(audit);
    return [...groups.high, ...groups.medium, ...groups.optimization].slice(0, limit);
  }

  function executiveSummary(audit) {
    const lowest = scoreRows(audit)
      .slice()
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .slice(0, 4)
      .map(([label]) => label.toLowerCase());

    if (!lowest.length) {
      return "Our analysis identified measurable opportunities to improve the website's clarity, visibility, and ability to support business growth.";
    }

    const list = lowest.length === 1
      ? lowest[0]
      : lowest.slice(0, -1).join(", ") + ", and " + lowest.at(-1);

    return "Our analysis shows meaningful opportunities in " + list +
      ". Addressing the strongest findings can improve visibility, visitor confidence, and the path from interest to inquiry.";
  }

  function websiteAssessment(audit) {
    const n = score(audit?.websiteHealthScore);
    if (n === null) {
      return "The website has measurable strengths and improvement opportunities. The recommendations in this report prioritize the areas supported by the clearest public evidence.";
    }
    if (n < 45) {
      return "The website shows substantial room for modernization across several measured areas. Prioritizing the highest-impact issues can create a stronger digital foundation.";
    }
    if (n < 65) {
      return "The website has a solid foundation but shows meaningful opportunities across several key areas. Focused improvements can strengthen visibility, trust, and conversion paths.";
    }
    if (n < 80) {
      return "The website has a solid overall foundation. The clearest opportunity is to strengthen a smaller set of measurable areas that can improve visibility and conversion quality.";
    }
    return "The website presents a strong foundation. The remaining recommendations are primarily optimization opportunities designed to strengthen consistency, discoverability, and conversion efficiency.";
  }

  function emailDraft(audit) {
    const top = topFindings(audit, 2).map((item) => item.finding).filter(Boolean);
    return {
      subject: "Website Intelligence Report for " + audit.companyName,
      body: [
        "Hi,",
        "",
        "I took a look at the public-facing website for " + audit.companyName + " and put together a short Website Intelligence Report.",
        top.length ? "A couple of areas that stood out were " + top.join(" and ") + "." : "It highlights several measurable areas that may be worth reviewing.",
        "",
        "I've attached the report with the scorecard, supporting findings, and a practical 90-day improvement path.",
        "",
        "If it would be useful, I'd be happy to walk through the findings with you.",
        "",
        "Rudy McCormick",
        "Web Search Professionals",
        "websearchprofessionals.com"
      ].join("\n")
    };
  }

  async function logoData() {
    if (logoCache !== undefined) return logoCache;
    try {
      const response = await fetch(LOGO_URL, { mode: "cors" });
      if (!response.ok) throw new Error("Logo request failed.");
      const blob = await response.blob();
      logoCache = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      logoCache = null;
    }
    return logoCache;
  }

  function setColor(doc, values, mode = "text") {
    if (mode === "fill") doc.setFillColor(...values);
    else if (mode === "draw") doc.setDrawColor(...values);
    else doc.setTextColor(...values);
  }

  function fitText(doc, text, x, y, width, options = {}) {
    const {
      size = 10,
      color = C.text,
      style = "normal",
      lineHeight = 1.15,
      maxLines = 4,
      align = "left"
    } = options;

    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    setColor(doc, color);
    const lines = doc.splitTextToSize(String(text || ""), width).slice(0, maxLines);
    doc.text(lines, x, y, { lineHeightFactor: lineHeight, align });
    return y + lines.length * size * lineHeight;
  }

  function drawBrandHeader(doc, logo, pageType, pageNumber) {
    if (logo) {
      try {
        doc.addImage(logo, "PNG", 27, 13, 250, 82, undefined, "FAST");
      } catch {
        setColor(doc, C.navy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("WEB SEARCH", 28, 45);
        doc.text("PROFESSIONALS", 28, 69);
      }
    } else {
      setColor(doc, C.navy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("WEB SEARCH", 28, 45);
      doc.text("PROFESSIONALS", 28, 69);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("DISCOVER  •  OPTIMIZE  •  GROW", 28, 86);
    }

    setColor(doc, C.text);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setCharSpace(2.3);
    doc.text("W E B S I T E S", 445, 22);
    doc.text("H I G H E R  V I S I B I L I T Y", 445, 35);
    doc.text("R E A L  O P P O R T U N I T I E S", 445, 48);
    doc.setCharSpace(0);
    setColor(doc, C.blue, "draw");
    doc.setLineWidth(1.2);
    doc.line(445, 60, 490, 60);
    setColor(doc, C.muted);
    doc.setFontSize(9.5);
    doc.text("Data. Insight.", 445, 78);
    doc.text("A Smarter Online Future.", 445, 91);

    drawMountainRail(doc, pageType);
    drawFooter(doc, pageNumber);
  }

  function drawMountainRail(doc, pageType) {
    setColor(doc, [242, 248, 252], "fill");
    doc.triangle(335, 0, 365, 0, 570, 235, "F");
    setColor(doc, [229, 241, 250], "fill");
    doc.triangle(355, 0, 370, 0, 582, 245, "F");

    const top = pageType === 1 ? 115 : 95;
    const bottom = pageType === 1 ? 370 : 245;
    setColor(doc, [45, 124, 191], "fill");
    doc.triangle(596, top, 612, top, 612, bottom, "F");
    doc.triangle(455, bottom, 612, top + 35, 612, bottom, "F");
    setColor(doc, [29, 96, 164], "fill");
    doc.triangle(478, bottom, 558, top + 75, 612, bottom, "F");
    setColor(doc, [80, 155, 210], "fill");
    doc.triangle(518, bottom, 584, top + 105, 612, bottom, "F");

    setColor(doc, [221, 239, 250], "draw");
    doc.setLineWidth(1.1);
    doc.line(460, bottom + 18, 612, bottom - 125);
    doc.line(500, bottom + 22, 612, bottom - 75);

    if (pageType === 1 || pageType === 3) {
      setColor(doc, C.white);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setCharSpace(2.6);
      doc.text("H I G H E R", 505, 250);
      doc.text("V I S I B I L I T Y", 505, 264);
      doc.text("A  B R I G H T E R", 505, 278);
      doc.text("T O M O R R O W", 505, 292);
      doc.setCharSpace(0);
      setColor(doc, C.white, "draw");
      doc.line(520, 305, 550, 305);
    }
  }

  function drawFooter(doc, pageNumber) {
    setColor(doc, C.line, "draw");
    doc.setLineWidth(0.8);
    doc.line(27, 758, 585, 758);

    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text("WEB SEARCH PROFESSIONALS", 30, 776);

    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setCharSpace(1.4);
    doc.text("SEARCH FURTHER. GROW FASTER.", 155, 776);
    doc.setCharSpace(0);
    doc.text("websearchprofessionals.com", 423, 776);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.text(String(pageNumber), 574, 776);
  }

  function drawTitle(doc, subtitle) {
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(31);
    doc.text("Website Intelligence Report", 29, 145);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(21);
    doc.text(subtitle, 29, 174);
  }

  function drawCircleIcon(doc, x, y, label, fill = [228, 243, 253]) {
    setColor(doc, fill, "fill");
    doc.circle(x, y, 19, "F");
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(label.length > 3 ? 6.5 : 9);
    doc.text(label, x, y + 3, { align: "center" });
  }

  function drawScoreCard(doc, x, y, w, h, label, value, icon) {
    const n = score(value);
    if (n === null) return;
    setColor(doc, [247, 251, 254], "fill");
    setColor(doc, C.line, "draw");
    doc.roundedRect(x, y, w, h, 6, 6, "FD");

    drawCircleIcon(doc, x + 18, y + 18, icon || label.slice(0, 2).toUpperCase(), [229, 243, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const labelLines = doc.splitTextToSize(label, w - 16).slice(0, 2);
    doc.text(labelLines, x + 9, y + 43, { lineHeightFactor: 1.0 });

    const c = colorForScore(n);
    setColor(doc, c);
    doc.setFontSize(22);
    doc.text(String(n), x + w / 2, y + h - 31, { align: "center" });

    setColor(doc, [215, 226, 236], "fill");
    doc.roundedRect(x + 10, y + h - 17, w - 20, 6, 3, 3, "F");
    setColor(doc, c, "fill");
    doc.roundedRect(x + 10, y + h - 17, (w - 20) * n / 100, 6, 3, 3, "F");
  }

  function drawExecutiveScore(doc, x, y, w, label, value, icon) {
    const n = score(value);
    if (n === null) return;
    setColor(doc, [248, 252, 255], "fill");
    setColor(doc, C.line, "draw");
    doc.roundedRect(x, y, w, 88, 6, 6, "FD");
    drawCircleIcon(doc, x + w / 2, y + 18, icon, [235, 247, 254]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    const lines = doc.splitTextToSize(label, w - 10).slice(0, 2);
    doc.text(lines, x + w / 2, y + 41, { align: "center", lineHeightFactor: 1.0 });
    setColor(doc, colorForScore(n));
    doc.setFontSize(19);
    doc.text(String(n), x + w / 2, y + 70, { align: "center" });
    setColor(doc, [214, 225, 235], "fill");
    doc.roundedRect(x + 10, y + 78, w - 20, 5, 2, 2, "F");
    setColor(doc, colorForScore(n), "fill");
    doc.roundedRect(x + 10, y + 78, (w - 20) * n / 100, 5, 2, 2, "F");
  }

  function drawHealthHero(doc, audit) {
    const n = score(audit.websiteHealthScore);
    setColor(doc, C.navy2, "fill");
    doc.roundedRect(29, 276, 556, 175, 10, 10, "F");
    setColor(doc, [25, 137, 206], "fill");
    doc.triangle(470, 276, 585, 451, 410, 451, "F");
    setColor(doc, [37, 160, 222], "fill");
    doc.triangle(520, 330, 585, 451, 505, 451, "F");

    setColor(doc, [154, 214, 246], "draw");
    doc.setLineWidth(10);
    doc.circle(145, 362, 72, "S");
    setColor(doc, [231, 247, 255], "draw");
    doc.setLineWidth(6);
    doc.circle(145, 362, 60, "S");

    setColor(doc, C.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Website Health", 145, 343, { align: "center" });
    doc.setFontSize(42);
    doc.text(n === null ? "-" : String(n), 132, 389, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(22);
    doc.text("/100", 185, 389, { align: "center" });

    setColor(doc, [132, 195, 232], "draw");
    doc.setLineWidth(1);
    doc.line(245, 302, 245, 425);

    setColor(doc, [186, 225, 247]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setCharSpace(2.8);
    doc.text("O V E R A L L  A S S E S S M E N T", 272, 310);
    doc.setCharSpace(0);

    setColor(doc, C.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    const assessment = doc.splitTextToSize(toneForScore(n), 240).slice(0, 2);
    doc.text(assessment, 272, 348, { lineHeightFactor: 1.05 });
    fitText(doc, websiteAssessment(audit), 272, 395, 230, {
      size: 10.5,
      color: [235, 248, 255],
      maxLines: 4,
      lineHeight: 1.22
    });
  }

  function drawPage1(doc, audit, logo) {
    drawBrandHeader(doc, logo, 1, 1);
    drawTitle(doc, "Website Audit & Growth Opportunities");

    drawCircleIcon(doc, 52, 218, "WEB", [229, 244, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    fitText(doc, audit.companyName || "Website", 91, 211, 360, { size: 18, style: "bold", color: C.navy, maxLines: 1 });
    setColor(doc, C.text);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text("Audit Date: " + monthYear(audit.auditedAt), 91, 233);
    doc.text("Prepared by Web Search Professionals", 91, 250);

    drawHealthHero(doc, audit);

    drawCircleIcon(doc, 51, 485, "DOC", [229, 244, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Executive Summary", 84, 491);
    setColor(doc, C.blue, "draw");
    doc.setLineWidth(1.2);
    doc.line(260, 486, 584, 486);
    fitText(doc, executiveSummary(audit), 84, 515, 500, {
      size: 10.4,
      color: C.text,
      maxLines: 3,
      lineHeight: 1.25
    });

    const exec = executiveScores(audit);
    const gap = 6;
    const w = (556 - gap * 6) / 7;
    exec.slice(0, 7).forEach(([label, value, icon], i) =>
      drawExecutiveScore(doc, 29 + i * (w + gap), 564, w, label, value, icon)
    );

    setColor(doc, [237, 247, 253], "fill");
    doc.roundedRect(29, 668, 556, 72, 7, 7, "F");
    drawCircleIcon(doc, 57, 704, "TGT", [215, 239, 252]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Top Opportunities", 89, 706);
    setColor(doc, C.blue, "draw");
    doc.setLineWidth(1);
    doc.line(235, 680, 235, 728);

    const top = topFindings(audit, 3);
    top.forEach((item, index) => {
      const y = 686 + index * 16;
      setColor(doc, C.navy2, "fill");
      doc.circle(260, y + 1, 9, "F");
      setColor(doc, C.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.text(String(index + 1), 260, y + 4, { align: "center" });
      fitText(doc, item.finding || "Website improvement opportunity", 279, y + 4, 250, {
        size: 9,
        color: C.text,
        maxLines: 1
      });
    });
  }

  function drawSnapshot(doc, audit) {
    const x = 433;
    const y = 260;
    const w = 152;
    setColor(doc, [243, 249, 253], "fill");
    setColor(doc, C.line, "draw");
    doc.roundedRect(x, y, w, 250, 7, 7, "FD");

    drawCircleIcon(doc, x + 23, y + 23, "DOC", [220, 240, 252]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Audit Snapshot", x + 45, y + 25);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(2);
    doc.text("A T  A  G L A N C E", x + 45, y + 39);
    doc.setCharSpace(0);

    const mobile = score(audit.scores?.mobile);
    const mobileText = mobile === null
      ? "Not measured"
      : mobile >= 75 ? "Good" : mobile >= 55 ? "Fair to Good" : "Needs Attention";
    const rows = [
      ["Pages analyzed", String(Number(audit.pagesSampled || 0)), "DB"],
      ["Audit confidence", Number(audit.auditConfidence || 0) + "%", "BAR"],
      ["CMS detected", audit.platform?.cmsDetected || "Not determined", "CMS"],
      ["Mobile-first readiness", mobileText, "MOB"]
    ];

    rows.forEach(([label, value, icon], i) => {
      const ry = y + 72 + i * 43;
      if (i > 0) {
        setColor(doc, C.line, "draw");
        doc.line(x + 12, ry - 11, x + w - 12, ry - 11);
      }
      drawCircleIcon(doc, x + 24, ry + 3, icon, [222, 241, 252]);
      setColor(doc, C.text);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label, x + 47, ry);
      setColor(doc, C.navy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(value.length > 16 ? 9.5 : 13);
      fitText(doc, value, x + 47, ry + 16, w - 58, {
        size: value.length > 16 ? 9.5 : 13,
        color: C.navy,
        style: "bold",
        maxLines: 2,
        lineHeight: 1.0
      });
    });
  }

  function drawFindingCard(doc, x, y, w, h, finding, color, soft, icon) {
    setColor(doc, soft, "fill");
    setColor(doc, color, "draw");
    doc.setLineWidth(2.5);
    doc.roundedRect(x, y, w, h, 6, 6, "FD");
    drawCircleIcon(doc, x + 24, y + 25, icon, soft);
    fitText(doc, finding?.finding || "Website opportunity", x + 48, y + 21, w - 64, {
      size: 10.5,
      color,
      style: "bold",
      maxLines: 2,
      lineHeight: 1.0
    });
    fitText(doc, finding?.businessImplication || "This area presents a measurable opportunity for website improvement.", x + 48, y + 45, w - 60, {
      size: 8.5,
      color: C.text,
      maxLines: 3,
      lineHeight: 1.15
    });
  }

  function drawPage2(doc, audit, logo) {
    drawBrandHeader(doc, logo, 2, 2);
    drawTitle(doc, "Detailed Scorecard & Findings");

    drawCircleIcon(doc, 50, 218, "BAR", [229, 244, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Website Scorecard", 83, 222);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(2);
    doc.text("K E Y  A R E A S  A S S E S S E D  F O R  Y O U R  O N L I N E  P E R F O R M A N C E", 83, 240);
    doc.setCharSpace(0);

    const rows = scoreRows(audit).slice(0, 8);
    const cardW = 93;
    const cardH = 118;
    const gapX = 7;
    const startX = 29;
    const startY = 260;
    rows.forEach(([label, value, icon], index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      drawScoreCard(
        doc,
        startX + col * (cardW + gapX),
        startY + row * (cardH + 9),
        cardW,
        cardH,
        label,
        value,
        icon
      );
    });

    drawSnapshot(doc, audit);

    drawCircleIcon(doc, 50, 545, "FIND", [229, 244, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Key Findings", 83, 549);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(2);
    doc.text("E V I D E N C E - B A S E D  I N S I G H T S  F R O M  O U R  A N A L Y S I S", 83, 567);
    doc.setCharSpace(0);

    const findings = topFindings(audit, 4);
    while (findings.length < 4) {
      const row = rows[findings.length] || rows[0];
      if (!row) break;
      findings.push(fallbackFinding(row[0], row[1]));
    }

    findings.slice(0, 4).forEach((finding, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const priority = priorityFor(audit, finding);
      const color = priority === "high" ? C.red : priority === "medium" ? C.orange : C.blue2;
      const soft = priority === "high" ? C.redSoft : priority === "medium" ? C.orangeSoft : C.paleBlue;
      drawFindingCard(
        doc,
        29 + col * 282,
        586 + row * 83,
        267,
        72,
        finding,
        color,
        soft,
        String(finding.area || "WEB").slice(0, 4).toUpperCase()
      );
    });
  }

  function recommendationLine(doc, x, y, number, finding, color, width) {
    setColor(doc, color, "fill");
    doc.circle(x, y - 4, 13, "F");
    setColor(doc, C.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(String(number), x, y, { align: "center" });
    fitText(doc, finding?.finding || "Website improvement opportunity", x + 28, y - 11, width - 28, {
      size: 11,
      color: C.navy,
      style: "bold",
      maxLines: 1
    });
    fitText(doc, finding?.businessImplication || "Review this measured opportunity as part of the next website improvement cycle.", x + 28, y + 7, width - 28, {
      size: 8.2,
      color: C.text,
      maxLines: 2,
      lineHeight: 1.05
    });
  }

  function priorityBlock(doc, y, h, label, sideCopy, color, soft, items, icon) {
    setColor(doc, soft, "fill");
    setColor(doc, C.line, "draw");
    doc.roundedRect(24, y, 562, h, 6, 6, "FD");
    setColor(doc, soft, "fill");
    doc.roundedRect(24, y, 150, h, 6, 6, "F");
    drawCircleIcon(doc, 58, y + 32, icon, color.map((v) => Math.min(255, v + 10)));
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    const labelLines = doc.splitTextToSize(label, 90).slice(0, 2);
    doc.text(labelLines, 95, y + 28, { lineHeightFactor: 1.0 });
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(1.8);
    const sideLines = doc.splitTextToSize(sideCopy.toUpperCase(), 88).slice(0, 4);
    doc.text(sideLines, 95, y + 64, { lineHeightFactor: 1.4 });
    doc.setCharSpace(0);

    const list = items.length ? items : [{
      finding: "Continue monitoring this priority level",
      businessImplication: "No additional recommendations were generated for this priority level."
    }];

    const maxItems = h >= 120 ? 3 : h >= 100 ? 2 : 1;
    const spacing = (h - 18) / maxItems;
    list.slice(0, maxItems).forEach((finding, index) => {
      recommendationLine(doc, 200, y + 27 + index * spacing, index + 1, finding, color, 345);
      if (index < maxItems - 1) {
        setColor(doc, C.line, "draw");
        doc.line(187, y + 48 + index * spacing, 570, y + 48 + index * spacing);
      }
    });
  }

  function drawRoadmap(doc, audit) {
    const x = 24;
    const y = 635;
    setColor(doc, [232, 245, 253], "fill");
    doc.roundedRect(x, y, 562, 77, 6, 6, "F");
    drawCircleIcon(doc, 58, y + 35, "CAL", [205, 234, 251]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("90-Day Roadmap", 96, y + 29);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setCharSpace(1.6);
    doc.text("A  C L E A R  P A T H", 96, y + 47);
    doc.text("F R O M  I N S I G H T", 96, y + 58);
    doc.text("T O  I M P A C T", 96, y + 69);
    doc.setCharSpace(0);
    setColor(doc, C.blue, "draw");
    doc.line(225, y + 10, 225, y + 66);

    const low = scoreRows(audit).slice().sort((a, b) => Number(a[1]) - Number(b[1]));
    const focus1 = low[0]?.[0] || "audit cleanup";
    const focus2 = low[1]?.[0] || "content and CTA";
    const focus3 = low[2]?.[0] || "SEO and measurement";
    const steps = [
      ["1", "Days 1–30", "Audit cleanup and " + focus1.toLowerCase()],
      ["2", "Days 31–60", focus2 + " improvements"],
      ["3", "Days 61–90", focus3 + " refinement"]
    ];

    steps.forEach(([num, title, copy], index) => {
      const sx = 252 + index * 108;
      setColor(doc, index === 0 ? C.navy2 : C.blue2, "fill");
      doc.circle(sx, y + 25, 13, "F");
      setColor(doc, C.white);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(num, sx, y + 29, { align: "center" });
      setColor(doc, C.navy);
      doc.setFontSize(8.5);
      doc.text(title, sx + 20, y + 28);
      fitText(doc, copy, sx + 20, y + 46, 82, {
        size: 7.5,
        color: C.text,
        maxLines: 2,
        lineHeight: 1.05
      });
    });
  }

  function drawPreparedBlock(doc) {
    setColor(doc, [242, 249, 253], "fill");
    doc.roundedRect(24, 720, 562, 31, 5, 5, "F");
    drawCircleIcon(doc, 58, 735, "DOC", [218, 240, 253]);
    setColor(doc, C.navy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.text("Prepared by Web Search Professionals", 91, 733);
    setColor(doc, C.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text("Opportunity-focused website improvement plan", 91, 746);
  }

  function drawPage3(doc, audit, logo) {
    drawBrandHeader(doc, logo, 3, 3);
    drawTitle(doc, "Priority Recommendations & Next Steps");

    drawCircleIcon(doc, 50, 218, "TGT", [229, 244, 253]);
    fitText(doc,
      "These recommendations are based on our analysis of the website's current measurable condition and the clearest opportunities for growth. Each item includes a practical business implication to guide next steps.",
      91,
      211,
      350,
      { size: 10, color: C.text, maxLines: 3, lineHeight: 1.25 }
    );

    const groups = groupsFor(audit);
    priorityBlock(
      doc,
      265,
      128,
      "High Priority",
      "Biggest impact for growth",
      C.red,
      C.redSoft,
      groups.high,
      "!"
    );
    priorityBlock(
      doc,
      401,
      112,
      "Medium Priority",
      "Build momentum and expand opportunities",
      C.orange,
      C.orangeSoft,
      groups.medium,
      "BAR"
    );
    priorityBlock(
      doc,
      521,
      96,
      "Optimization",
      "Ongoing improvement for long-term success",
      C.green,
      C.greenSoft,
      groups.optimization,
      "OPT"
    );

    drawRoadmap(doc, audit);
    drawPreparedBlock(doc);
  }

  async function makePdf(audit, save = true) {
    const JsPDF = window.jspdf?.jsPDF;
    if (!JsPDF) {
      toast("PDF library is still loading. Try again in a moment.");
      return null;
    }

    const logo = await logoData();
    const doc = new JsPDF({
      unit: "pt",
      format: "letter",
      orientation: "portrait",
      compress: true,
      putOnlyUsedFonts: true
    });

    drawPage1(doc, audit, logo);
    doc.addPage();
    drawPage2(doc, audit, logo);
    doc.addPage();
    drawPage3(doc, audit, logo);

    if (save) doc.save(filename(audit));
    return doc;
  }

  function filename(audit) {
    const stem = String(audit.companyName || "website")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "website";
    return stem + "-website-intelligence-report.pdf";
  }

  function injectUiStyles() {
    if (document.querySelector("#wir-v2-styles")) return;
    const style = document.createElement("style");
    style.id = "wir-v2-styles";
    style.textContent = `
      .wir2-actions{margin:14px 0 4px;padding:12px;border:1px solid #cfe3f1;border-radius:12px;background:linear-gradient(135deg,#f7fbfe,#edf7fd)}
      .wir2-actions strong{display:block;color:#082b63;margin-bottom:8px}
      .wir2-buttons{display:flex;flex-wrap:wrap;gap:7px}
      .wir2-buttons button{border:1px solid #b9d5e8;background:#fff;color:#0b4c86;border-radius:7px;padding:7px 10px;font:700 10px Arial;cursor:pointer}
      .wir2-buttons button:first-child{background:#0f5d9d;color:#fff;border-color:#0f5d9d}
      .wir2-actions small{display:block;margin-top:7px;color:#607a9c;font-size:9px}
      .wir2-overlay{position:fixed;inset:0;z-index:99999;background:rgba(3,23,49,.88);padding:18px;display:flex;flex-direction:column}
      .wir2-toolbar{display:flex;gap:8px;flex-wrap:wrap;padding:10px;background:#082b63;border-radius:10px 10px 0 0}
      .wir2-toolbar button{border:0;border-radius:7px;padding:9px 12px;font-weight:700;cursor:pointer;background:#fff;color:#0b4c86}
      .wir2-toolbar .close{margin-left:auto;background:#d83c3c;color:#fff}
      .wir2-frame{width:100%;height:calc(100vh - 80px);border:0;background:#dce8f0}
      .wir2-toast{position:fixed;right:20px;bottom:20px;z-index:100000;padding:10px 14px;background:#082b63;color:#fff;border-radius:9px;box-shadow:0 4px 16px rgba(0,0,0,.2)}
    `;
    document.head.appendChild(style);
  }

  function toast(message) {
    injectUiStyles();
    document.querySelector(".wir2-toast")?.remove();
    const node = document.createElement("div");
    node.className = "wir2-toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2800);
  }

  async function preview(audit) {
    injectUiStyles();
    const doc = await makePdf(audit, false);
    if (!doc) return;

    document.querySelector(".wir2-overlay")?.remove();
    const url = URL.createObjectURL(doc.output("blob"));
    const overlay = document.createElement("div");
    overlay.className = "wir2-overlay";
    overlay.innerHTML = `
      <div class="wir2-toolbar">
        <button data-wir2-download>Download PDF</button>
        <button data-wir2-print>Open / Print</button>
        <button data-wir2-email>Email Report</button>
        <button data-wir2-copy>Copy Email</button>
        <button class="close" data-wir2-close>Close</button>
      </div>
      <iframe class="wir2-frame" title="Website Intelligence Report preview"></iframe>`;
    document.body.appendChild(overlay);
    overlay.querySelector("iframe").src = url;

    const close = () => {
      URL.revokeObjectURL(url);
      overlay.remove();
    };
    overlay.querySelector("[data-wir2-close]").onclick = close;
    overlay.querySelector("[data-wir2-download]").onclick = () => makePdf(audit, true);
    overlay.querySelector("[data-wir2-print]").onclick = () => openForPrint(audit);
    overlay.querySelector("[data-wir2-email]").onclick = () => emailReport(audit, prospectEmail(audit));
    overlay.querySelector("[data-wir2-copy]").onclick = () => copyEmail(audit);
  }

  async function openForPrint(audit) {
    const doc = await makePdf(audit, false);
    if (!doc) return;
    const url = URL.createObjectURL(doc.output("blob"));
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) {
      URL.revokeObjectURL(url);
      toast("Allow pop-ups to open the printable PDF.");
      return;
    }
    toast("PDF opened. Use the PDF viewer's Print button.");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  async function copyEmail(audit) {
    const draft = emailDraft(audit);
    try {
      await navigator.clipboard.writeText(
        "Subject: " + draft.subject + "\n\n" + draft.body
      );
      toast("Email draft copied.");
    } catch {
      toast("Could not copy the email draft.");
    }
  }

  function prospectEmail(audit) {
    const card = [...document.querySelectorAll(".prospect-card")].find((node) =>
      hostKey(node.querySelector(".website-link")?.href) === hostKey(audit.website)
    );
    return card?.querySelector('a[href^="mailto:"]')
      ?.getAttribute("href")
      ?.replace(/^mailto:/i, "") ||
      prospects.get(hostKey(audit.website))?.email ||
      "";
  }

  async function emailReport(audit, email = "") {
    await makePdf(audit, true);
    const draft = emailDraft(audit);
    toast("PDF downloaded. Attach it to the email before sending.");
    setTimeout(() => {
      location.href =
        "mailto:" + encodeURIComponent(email) +
        "?subject=" + encodeURIComponent(draft.subject) +
        "&body=" + encodeURIComponent(
          draft.body +
          "\n\nThe Website Intelligence PDF has been downloaded and is ready to attach."
        );
    }, 350);
  }

  function captureAudit(audit, context = {}) {
    if (!audit) return;
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
  }

  function capturePayload(data) {
    if (!data || typeof data !== "object") return;

    if (data.enrichment?.websiteAudit) {
      captureAudit(data.enrichment.websiteAudit, {
        companyName: data.enrichment.companyName,
        website: data.enrichment.website
      });
    }

    if (data.job?.items) {
      for (const item of data.job.items) {
        if (!item.enrichment?.websiteAudit) continue;
        captureAudit(item.enrichment.websiteAudit, {
          companyName: item.company_name,
          website: item.website,
          email:
            item.contact_resolution?.primaryDecisionMaker?.publicBusinessEmail ||
            (item.contact_resolution?.contactPaths || []).find((path) => path.type === "email")?.value ||
            ""
        });
      }
    }
  }

  function injectActions(card, audit) {
    let box = card.querySelector(".wir2-actions");
    if (box) return;

    const target = card.querySelector(".prospect-enrichment") || card;
    box = document.createElement("div");
    box.className = "wir2-actions";
    box.innerHTML = `
      <strong>Website Intelligence Report</strong>
      <div class="wir2-buttons">
        <button data-action="preview">Preview</button>
        <button data-action="pdf">Download PDF</button>
        <button data-action="print">Print</button>
        <button data-action="email">Email Report</button>
      </div>
      <small>Client-facing Web Search Professionals report. Internal prospect scoring is excluded.</small>`;

    target.parentNode.insertBefore(box, target.nextSibling);
    box.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      if (action === "preview") preview(audit);
      if (action === "pdf") makePdf(audit, true);
      if (action === "print") openForPrint(audit);
      if (action === "email") emailReport(audit, prospectEmail(audit));
    });
  }

  function scan() {
    injectUiStyles();
    for (const card of document.querySelectorAll(".prospect-card")) {
      const website = card.querySelector(".website-link")?.href;
      const audit = audits.get(hostKey(website));
      if (audit) injectActions(card, audit);
    }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 100);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const clone = response.clone();
      const type = clone.headers.get("content-type") || "";
      if (type.includes("application/json")) {
        clone.json().then(capturePayload).catch(() => {});
      }
    } catch {}
    return response;
  };

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.WebsiteIntelligenceReports = {
    preview,
    downloadPdf: (audit) => makePdf(audit, true),
    print: openForPrint,
    email: emailReport,
    captureAudit
  };

  injectUiStyles();
})();

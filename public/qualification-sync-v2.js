(() => {
  const esc = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const hostKey = (value) => {
    try {
      return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return String(value || "").toLowerCase().replace(/^www\./, "");
    }
  };

  const stageLabel = (value) => String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  const scoreValue = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  function findCard(item) {
    const target = hostKey(item.website);
    const cards = [...document.querySelectorAll(".prospect-card")];
    return cards.find((card) => {
      const href = card.querySelector(".website-link")?.href;
      return href && hostKey(href) === target;
    }) || cards.find((card) =>
      card.querySelector("h3")?.textContent?.trim() ===
      String(item.company_name || "").trim()
    );
  }

  function simpleList(items, render, empty = "None verified.") {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!values.length) return "<p>" + esc(empty) + "</p>";
    return '<ul class="auto-detail-list">' +
      values.slice(0, 6).map(render).join("") +
      "</ul>";
  }

  function renderContact(item) {
    const resolution = item.contact_resolution;
    if (!resolution) return "";
    const person = resolution.primaryDecisionMaker;
    const email = person?.publicBusinessEmail ||
      (resolution.contactPaths || []).find((path) => path.type === "email")?.value || "";

    return `
      <div class="auto-contact-resolution">
        <p class="eyebrow">Agent 4 contact resolution</p>
        <h5>${person
          ? esc(person.name) + " — " + esc(person.title)
          : "No sufficiently verified decision-maker found"}</h5>
        ${email ? `<p><a href="mailto:${esc(email)}">${esc(email)}</a></p>` : ""}
        <p>${esc(resolution.resolutionSummary || "Contact resolution completed.")}</p>
      </div>`;
  }

  function renderOutreach(item) {
    const outreach = item.outreach_package;
    if (!outreach) return "";
    return `
      <div class="auto-outreach-summary">
        <p class="eyebrow">Agent 5 outreach drafted</p>
        <p><strong>${esc(outreach.primaryEmail?.subject || "Outreach package ready")}</strong></p>
        <p>${esc(outreach.personalizationSummary || "Research-driven outreach package created.")}</p>
      </div>`;
  }

  function renderEnrichment(item) {
    const enrichment = item.enrichment;
    if (!enrichment) return "";

    const audit = enrichment.websiteAudit;
    const health = scoreValue(audit?.websiteHealthScore);
    const opportunity = scoreValue(item.scoring?.marketingOpportunityScore);

    const decisionMakers = simpleList(
      enrichment.decisionMakers,
      (person) => `<li><strong>${esc(person.name)}</strong> — ${esc(person.title)}</li>`
    );

    const marketing = simpleList(
      enrichment.marketingSignals,
      (signal) =>
        `<li><strong>${esc(stageLabel(signal.area || "other"))}:</strong> ${esc(signal.finding)}</li>`
    );

    const growth = simpleList(
      enrichment.growthSignals,
      (signal) => `<li>${esc(signal.signal || signal.whyItMatters || "Verified growth signal")}</li>`
    );

    const fallbackNote = enrichment.enrichmentFallbackUsed
      ? '<div class="auto-fallback-note"><strong>Resilient enrichment used.</strong> The primary formatter could not complete, so the evidence-preserving fallback was used.</div>'
      : "";

    return `
      <div class="enrichment-panel automated-enrichment-panel">
        <div class="enrichment-heading">
          <div>
            <p class="eyebrow">Agent 2 automated enrichment</p>
            <h4>${esc(enrichment.opportunitySummary || "Enrichment completed.")}</h4>
          </div>
          <div class="enrichment-score">
            <strong>${Number(enrichment.enrichmentConfidence || 0)}</strong>
            <small>enrichment confidence</small>
          </div>
        </div>
        ${fallbackNote}
        <p class="enrichment-summary">${esc(enrichment.businessSummary || "")}</p>
        <div class="auto-stage-scorecards">
          ${health !== null ? `<div><small>Website Health</small><strong>${health}/100</strong></div>` : ""}
          ${opportunity !== null ? `<div><small>Marketing Opportunity</small><strong>${opportunity}/100</strong></div>` : ""}
          ${audit?.pagesSampled ? `<div><small>Pages Audited</small><strong>${Number(audit.pagesSampled)}</strong></div>` : ""}
          <div><small>Pipeline Stage</small><strong class="stage-text">${esc(stageLabel(item.stage))}</strong></div>
        </div>
        <div class="enrichment-grid">
          <section><h5>Decision-makers</h5>${decisionMakers}</section>
          <section><h5>Growth signals</h5>${growth}</section>
          <section><h5>Marketing findings</h5>${marketing}</section>
          <section><h5>Automation result</h5><p><strong>Status:</strong> ${esc(stageLabel(item.status))}</p>${opportunity !== null ? `<p><strong>Opportunity score:</strong> ${opportunity}/100</p>` : ""}</section>
        </div>
        ${renderContact(item)}
        ${renderOutreach(item)}
      </div>`;
  }

  function showItemError(card, item) {
    const container = card?.querySelector(".prospect-enrichment");
    if (!container || !item.last_error) return;

    let notice = container.querySelector(".auto-qualification-error");
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "auto-qualification-error";
      container.appendChild(notice);
    }

    const hardFailure = item.status === "FAILED";
    notice.classList.toggle("warning", !hardFailure);
    notice.innerHTML =
      `<strong>${hardFailure ? "Automated enrichment failed" : "Pipeline warning / partial completion"}</strong>` +
      `<p>${esc(item.last_error)}</p>`;
    container.hidden = false;
  }

  function hydrateCard(item) {
    const card = findCard(item);
    if (!card) return;

    const container = card.querySelector(".prospect-enrichment");
    const enrichButton = card.querySelector(".enrich-button");

    if (item.enrichment && container) {
      container.innerHTML = renderEnrichment(item);
      container.hidden = false;

      if (enrichButton) {
        enrichButton.textContent = item.status === "PARTIAL"
          ? "Enriched - Later Stage Warning"
          : "Enriched (Auto)";
        enrichButton.classList.add("enriched");
        enrichButton.disabled = true;
      }
    } else if (item.status === "FAILED" && container) {
      container.hidden = false;
      if (enrichButton) {
        enrichButton.textContent = "Retry Enrichment";
        enrichButton.disabled = false;
      }
    }

    showItemError(card, item);
  }

  function decorateDashboard(job) {
    const panel = document.querySelector("#qualification-job");
    if (!panel) return;

    panel.dataset.jobId = job.id || "";

    let meta = panel.querySelector(".qualification-job-meta");
    if (!meta) {
      meta = document.createElement("div");
      meta.className = "qualification-job-meta";
      panel.prepend(meta);
    }
    meta.textContent = job.id ? "Qualification job: " + job.id : "";

    const counts = job.counts || {};
    const countBox = panel.querySelector(".qualification-counts");
    if (countBox && !countBox.querySelector("[data-partial-count]")) {
      const partial = document.createElement("span");
      partial.dataset.partialCount = "true";
      partial.innerHTML = 'Partial <strong>' + Number(counts.partial || 0) + '</strong>';
      countBox.appendChild(partial);
    } else if (countBox) {
      const partial = countBox.querySelector("[data-partial-count]");
      partial.innerHTML = 'Partial <strong>' + Number(counts.partial || 0) + '</strong>';
    }

    const rows = [...panel.querySelectorAll(".qualification-item")];
    (job.items || []).forEach((item, index) => {
      const row = rows[index];
      if (!row) return;

      let state = row.querySelector(".qualification-state-badge");
      if (!state) {
        state = document.createElement("span");
        state.className = "qualification-state-badge";
        row.appendChild(state);
      }
      state.className = "qualification-state-badge status-" + String(item.status || "").toLowerCase();
      state.textContent = stageLabel(item.status || item.stage);

      if (!item.last_error) return;
      let detail = row.querySelector(".qualification-error-detail");
      if (!detail) {
        detail = document.createElement("div");
        detail.className = "qualification-error-detail";
        row.appendChild(detail);
      }
      detail.classList.toggle("warning", item.status !== "FAILED");
      detail.textContent = item.last_error;
    });

    if (job.last_error) {
      let jobError = panel.querySelector(".qualification-job-error");
      if (!jobError) {
        jobError = document.createElement("div");
        jobError.className = "qualification-job-error";
        panel.appendChild(jobError);
      }
      jobError.textContent = job.last_error;
    }
  }

  function syncJob(job) {
    if (!job || !Array.isArray(job.items)) return;
    for (const item of job.items) hydrateCard(item);
    decorateDashboard(job);
  }

  const style = document.createElement("style");
  style.textContent = `
    .qualification-job-meta{margin-bottom:8px;color:#607a9c;font-size:9px;word-break:break-all}
    .qualification-error-detail{grid-column:1/-1;width:100%;margin-top:7px;padding:7px 9px;border-radius:7px;background:#fff0ef;color:#9b3128;font-size:9px;line-height:1.4;word-break:break-word}
    .qualification-error-detail.warning{background:#fff8e8;color:#8b6500}
    .qualification-job-error,.auto-qualification-error{margin-top:10px;padding:10px;border-radius:9px;background:#fff0ef;color:#8f2f28;font-size:10px;line-height:1.5}
    .auto-qualification-error.warning,.auto-fallback-note{background:#fff8e8;color:#806000}
    .auto-qualification-error strong,.auto-fallback-note strong{display:block;margin-bottom:4px}
    .auto-qualification-error p{margin:0}
    .auto-fallback-note{margin:10px 0;padding:9px 10px;border-radius:8px;font-size:10px}
    .auto-stage-scorecards{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
    .auto-stage-scorecards>div{min-width:105px;padding:8px 10px;border:1px solid #d8e6f0;border-radius:9px;background:#f7fbfe}
    .auto-stage-scorecards small,.auto-stage-scorecards strong{display:block}
    .auto-stage-scorecards small{color:#607a9c;font-size:9px}
    .auto-stage-scorecards strong{margin-top:2px;color:#0b4c86;font-size:17px}
    .auto-stage-scorecards .stage-text{font-size:12px}
    .auto-detail-list{margin:0;padding-left:17px}.auto-detail-list li{margin:5px 0}
    .auto-contact-resolution,.auto-outreach-summary{margin-top:14px;padding:12px;border:1px solid #d7e5f1;border-radius:10px;background:#f5faff}
    .qualification-item{flex-wrap:wrap}
    .qualification-state-badge{margin-left:auto;border-radius:999px;padding:4px 7px;background:#eef3f7;color:#4d6785;font-size:9px}
    .qualification-state-badge.status-partial{background:#fff4d9;color:#8b6500}
    .qualification-state-badge.status-failed{background:#fff0ef;color:#9b3128}
    .qualification-state-badge.status-completed{background:#edf8f0;color:#257b47}
    .qualification-state-badge.status-stopped{background:#eef3f7;color:#526b86}
  `;
  document.head.appendChild(style);

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const clone = response.clone();
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (/\/api\/public\/qualification-jobs\/[0-9a-f-]+$/i.test(url)) {
        clone.json().then((data) => {
          if (data?.job) setTimeout(() => syncJob(data.job), 80);
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  window.QualificationSync = { syncJob };
})();

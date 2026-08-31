const form = document.querySelector("#search-form");
const button = document.querySelector("#search-button");
const industrySelect = document.querySelector("#industry");
const industryDescription = document.querySelector("#industry-description");
const priorityGrid = document.querySelector("#priority-grid");
const companyTypeGrid = document.querySelector("#company-type-grid");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const errorState = document.querySelector("#error-state");
const resultsState = document.querySelector("#results-state");
const resultsList = document.querySelector("#results-list");
const resultsTitle = document.querySelector("#results-title");
const resultsSummary = document.querySelector("#results-summary");
const errorMessage = document.querySelector("#error-message");
const loadingTitle = document.querySelector("#loading-title");
const loadingMessage = document.querySelector("#loading-message");
const persistenceNote = document.querySelector("#persistence-note");
const exportButton = document.querySelector("#export-csv");
const tryAgainButton = document.querySelector("#try-again");

let industries = [];
let lastProspects = [];
let lastDiscovery = null;
let loadingTimer;

function currentIndustry() {
  return industries.find((item) => item.id === industrySelect.value) || null;
}

function setView(view) {
  emptyState.hidden = view !== "empty";
  loadingState.hidden = view !== "loading";
  errorState.hidden = view !== "error";
  resultsState.hidden = view !== "results";
}

function selectedValues(name) {
  return [...document.querySelectorAll('input[name="' + name + '"]:checked')]
    .map((input) => input.value);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function safeEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function createCheck(name, option, checked) {
  const label = document.createElement("label");
  label.className = "check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.value = option.id;
  input.checked = checked;

  const span = document.createElement("span");
  span.textContent = option.label;

  label.append(input, span);
  return label;
}

function renderIndustryControls() {
  const industry = currentIndustry();
  priorityGrid.innerHTML = "";
  companyTypeGrid.innerHTML = "";

  if (!industry) {
    industryDescription.textContent =
      "Choose an industry to load its prospecting criteria.";
    return;
  }

  industryDescription.textContent = industry.description;

  const defaults = new Set(industry.defaultPriorities || []);
  industry.capabilities.forEach((option) => {
    priorityGrid.append(
      createCheck("priority", option, defaults.has(option.id))
    );
  });

  industry.companyTypes.forEach((option) => {
    const checked = ["independent", "small_group"].includes(option.id);
    companyTypeGrid.append(
      createCheck("companyType", option, checked)
    );
  });
}

function capabilityLabel(id, industry = currentIndustry()) {
  return (
    industry?.capabilities.find((item) => item.id === id)?.label ||
    id
  );
}

function companyTypeLabel(id, industry = currentIndustry()) {
  return (
    industry?.companyTypes.find((item) => item.id === id)?.label ||
    id ||
    "Unknown"
  );
}

function renderCapabilities(capabilities = [], industry) {
  if (!capabilities.length) {
    return '<span class="tag">No verified priorities</span>';
  }

  return capabilities
    .map(
      (id) =>
        '<span class="tag active">' +
        escapeHtml(capabilityLabel(id, industry)) +
        "</span>"
    )
    .join("");
}

function renderEvidence(evidence = []) {
  return evidence
    .map((item) => {
      const href = safeUrl(item.url);
      return (
        "<li>" +
        escapeHtml(item.fact) +
        (href !== "#"
          ? '<br><a href="' +
            href +
            '" target="_blank" rel="noopener noreferrer">View source</a>'
          : "") +
        "</li>"
      );
    })
    .join("");
}


function renderContactPaths(paths = []) {
  if (!paths.length) return "<p>No additional verified public contact paths found.</p>";

  return (
    '<ul class="enrichment-list">' +
    paths
      .map((path) => {
        const href = path.url ? safeUrl(path.url) : "#";
        const email =
          path.type === "email" && path.value ? safeEmail(path.value) : "";

        let action = "";

        if (email) {
          action =
            ' <a href="mailto:' +
            escapeHtml(email) +
            '">' +
            escapeHtml(email) +
            "</a>";
        } else if (href !== "#") {
          action =
            ' <a href="' +
            href +
            '" target="_blank" rel="noopener noreferrer">Open ↗</a>';
        } else if (path.value) {
          action = " " + escapeHtml(path.value);
        }

        return (
          "<li><strong>" +
          escapeHtml(path.label) +
          ":</strong>" +
          action +
          "</li>"
        );
      })
      .join("") +
    "</ul>"
  );
}

function renderDecisionMakers(people = []) {
  if (!people.length) return "<p>No verified decision-makers found.</p>";

  return (
    '<div class="decision-makers">' +
    people
      .map((person) => {
        const profile = person.professionalUrl
          ? safeUrl(person.professionalUrl)
          : "#";
        const email = safeEmail(person.publicBusinessEmail);

        return (
          '<article class="person-card">' +
          "<strong>" +
          escapeHtml(person.name) +
          "</strong>" +
          "<span>" +
          escapeHtml(person.title) +
          "</span>" +
          "<small>" +
          Number(person.confidence || 0) +
          "% confidence</small>" +
          '<div class="person-links">' +
          (email
            ? '<a href="mailto:' +
              escapeHtml(email) +
              '">Email</a>'
            : "") +
          (profile !== "#"
            ? '<a href="' +
              profile +
              '" target="_blank" rel="noopener noreferrer">Profile ↗</a>'
            : "") +
          "</div>" +
          "</article>"
        );
      })
      .join("") +
    "</div>"
  );
}

function renderSignalItems(items = [], kind = "growth") {
  if (!items.length) {
    return "<p>No strong " + escapeHtml(kind) + " signals were verified.</p>";
  }

  return (
    '<ul class="signal-list">' +
    items
      .map((item) => {
        const title =
          kind === "marketing"
            ? (item.type === "strength" ? "Strength" : item.type === "opportunity" ? "Opportunity" : "Observation") +
              " • " +
              String(item.area || "other").replaceAll("_", " ")
            : item.signal;

        const finding =
          kind === "marketing" ? item.finding : item.whyItMatters;

        return (
          "<li>" +
          "<strong>" +
          escapeHtml(title) +
          "</strong>" +
          (kind === "marketing"
            ? "<p>" + escapeHtml(finding) + "</p>"
            : "") +
          "<p>" +
          escapeHtml(item.whyItMatters || "") +
          "</p>" +
          "</li>"
        );
      })
      .join("") +
    "</ul>"
  );
}




function renderDraftCard(title, text, index, key) {
  return (
    '<article class="outreach-draft-card">' +
      '<div class="outreach-draft-head">' +
        '<h6>' + escapeHtml(title) + '</h6>' +
        '<button class="copy-draft-button" type="button" data-copy-outreach="' +
          escapeHtml(key) +
          '" data-copy-index="' +
          index +
          '">Copy</button>' +
      '</div>' +
      '<pre>' + escapeHtml(text || "") + '</pre>' +
    '</article>'
  );
}

function renderEmailDraft(title, draft, index, key) {
  const text =
    "Subject: " +
    String(draft?.subject || "") +
    "\n\n" +
    String(draft?.body || "");

  return renderDraftCard(title, text, index, key);
}

function renderOutreachPackage(outreach, index) {
  const evidence = (outreach.evidenceUsed || [])
    .map(
      (item) =>
        '<li><strong>' +
        escapeHtml(item.claim) +
        '</strong><br>' +
        escapeHtml(item.sourceContext) +
        '</li>'
    )
    .join("");

  const avoid = (outreach.claimsToAvoid || [])
    .map((item) => "<li>" + escapeHtml(item) + "</li>")
    .join("");

  return (
    '<div class="outreach-panel">' +
      '<div class="outreach-head">' +
        '<div>' +
          '<p class="eyebrow">Agent 5 personalized outreach</p>' +
          '<h4>' + escapeHtml(outreach.personalizationSummary) + '</h4>' +
          '<p>Preferred channel: <strong>' +
            escapeHtml(
              String(outreach.preferredChannel || "").replaceAll("_", " ")
            ) +
          '</strong></p>' +
        '</div>' +
        '<div class="outreach-confidence">' +
          '<strong>' + Number(outreach.generationConfidence || 0) + '</strong>' +
          '<small>draft confidence</small>' +
        '</div>' +
      '</div>' +

      '<div class="outreach-notice">' +
        '<strong>Draft only.</strong> Nothing is sent from this screen.' +
      '</div>' +

      '<div class="outreach-drafts">' +
        renderEmailDraft(
          "Primary email",
          outreach.primaryEmail,
          index,
          "primaryEmail"
        ) +
        renderEmailDraft(
          "Follow-up email",
          outreach.followUpEmail,
          index,
          "followUpEmail"
        ) +
        renderDraftCard(
          "LinkedIn message",
          outreach.linkedinMessage,
          index,
          "linkedinMessage"
        ) +
        renderDraftCard(
          "Call opener",
          outreach.callOpener,
          index,
          "callOpener"
        ) +
        renderDraftCard(
          "Contact-form message",
          outreach.contactFormMessage,
          index,
          "contactFormMessage"
        ) +
      '</div>' +

      '<div class="outreach-audit">' +
        '<section>' +
          '<h6>Evidence used</h6>' +
          '<ul>' + evidence + '</ul>' +
        '</section>' +
        (avoid
          ? '<section><h6>Claims to avoid</h6><ul>' + avoid + '</ul></section>'
          : "") +
      '</div>' +
    '</div>'
  );
}

function outreachTextForKey(outreach, key) {
  if (!outreach) return "";

  if (key === "primaryEmail") {
    return (
      "Subject: " +
      String(outreach.primaryEmail?.subject || "") +
      "\n\n" +
      String(outreach.primaryEmail?.body || "")
    );
  }

  if (key === "followUpEmail") {
    return (
      "Subject: " +
      String(outreach.followUpEmail?.subject || "") +
      "\n\n" +
      String(outreach.followUpEmail?.body || "")
    );
  }

  if (key === "linkedinMessage") return outreach.linkedinMessage || "";
  if (key === "callOpener") return outreach.callOpener || "";
  if (key === "contactFormMessage") return outreach.contactFormMessage || "";

  return "";
}

function renderResolvedDecisionMaker(person, label) {
  if (!person) {
    return '<div class="contact-person empty"><strong>' +
      escapeHtml(label) +
      '</strong><p>No sufficiently verified person was found.</p></div>';
  }

  const email = safeEmail(person.publicBusinessEmail);
  const profile = person.professionalUrl
    ? safeUrl(person.professionalUrl)
    : "#";

  return (
    '<article class="contact-person">' +
      '<p class="contact-label">' + escapeHtml(label) + '</p>' +
      '<h5>' + escapeHtml(person.name) + '</h5>' +
      '<p class="contact-title">' + escapeHtml(person.title) + '</p>' +
      '<p class="contact-why">' + escapeHtml(person.whyThisPerson) + '</p>' +
      '<div class="contact-actions">' +
        (email
          ? '<a href="mailto:' + escapeHtml(email) + '">Email</a>'
          : "") +
        (person.publicBusinessPhone
          ? '<a href="tel:' +
            escapeHtml(person.publicBusinessPhone) +
            '">' +
            escapeHtml(person.publicBusinessPhone) +
            '</a>'
          : "") +
        (profile !== "#"
          ? '<a href="' +
            profile +
            '" target="_blank" rel="noopener noreferrer">Profile ↗</a>'
          : "") +
      '</div>' +
      '<small>' + Number(person.confidence || 0) + '% contact confidence</small>' +
    '</article>'
  );
}

function renderResolvedContactPaths(paths = []) {
  if (!paths.length) {
    return "<p>No additional verified public business contact paths found.</p>";
  }

  return (
    '<ul class="resolved-paths">' +
    paths.map((path) => {
      const email = path.type === "email" ? safeEmail(path.value) : "";
      const href = path.url ? safeUrl(path.url) : "#";
      let action = "";

      if (email) {
        action = '<a href="mailto:' + escapeHtml(email) + '">' +
          escapeHtml(email) + '</a>';
      } else if (path.type === "phone" && path.value) {
        action = '<a href="tel:' + escapeHtml(path.value) + '">' +
          escapeHtml(path.value) + '</a>';
      } else if (href !== "#") {
        action = '<a href="' + href +
          '" target="_blank" rel="noopener noreferrer">Open ↗</a>';
      } else if (path.value) {
        action = '<span>' + escapeHtml(path.value) + '</span>';
      }

      return (
        '<li><div><strong>' + escapeHtml(path.label) + '</strong>' +
        '<small>' + Number(path.confidence || 0) + '% confidence</small></div>' +
        action + '</li>'
      );
    }).join("") +
    '</ul>'
  );
}

function renderContactResolution(resolution, index) {
  const secondary = (resolution.secondaryDecisionMakers || [])
    .map((person, i) =>
      renderResolvedDecisionMaker(person, "Secondary " + (i + 1))
    )
    .join("");

  const basis = (resolution.outreachAngle?.evidenceBasis || [])
    .map((item) => "<li>" + escapeHtml(item) + "</li>")
    .join("");

  const avoid = (resolution.outreachAngle?.avoidClaims || [])
    .map((item) => "<li>" + escapeHtml(item) + "</li>")
    .join("");

  return (
    '<div class="contact-resolution-panel">' +
      '<div class="contact-resolution-head">' +
        '<div>' +
          '<p class="eyebrow">Agent 4 deep contact resolution</p>' +
          '<h4>' + escapeHtml(resolution.resolutionSummary) + '</h4>' +
        '</div>' +
        '<div class="contact-resolution-confidence">' +
          '<strong>' + Number(resolution.resolutionConfidence || 0) + '</strong>' +
          '<small>resolution confidence</small>' +
        '</div>' +
      '</div>' +

      '<div class="contact-resolution-actions">' +
        '<button class="details-button outreach-compose-button" type="button" data-outreach-compose="' +
          index +
          '">Create Outreach Drafts</button>' +
      '</div>' +
      '<div id="outreach-output-' + index + '" class="outreach-output" hidden></div>' +
      '<div class="contact-resolution-grid">' +
        '<section>' +
          '<h5>Best decision-maker</h5>' +
          renderResolvedDecisionMaker(
            resolution.primaryDecisionMaker,
            "Primary contact"
          ) +
          secondary +
        '</section>' +

        '<section>' +
          '<h5>Verified contact routes</h5>' +
          renderResolvedContactPaths(resolution.contactPaths) +
        '</section>' +

        '<section class="outreach-angle-card">' +
          '<h5>Recommended outreach angle</h5>' +
          '<p class="angle-text">' +
            escapeHtml(resolution.outreachAngle?.angle || "") +
          '</p>' +
          '<p><strong>Channel:</strong> ' +
            escapeHtml(
              String(resolution.outreachAngle?.recommendedChannel || "")
                .replaceAll("_", " ")
            ) +
          '</p>' +
          '<p>' +
            escapeHtml(resolution.outreachAngle?.reasonForChannel || "") +
          '</p>' +
          '<h6>Evidence basis</h6>' +
          '<ul>' + basis + '</ul>' +
          (avoid
            ? '<h6>Avoid claiming</h6><ul>' + avoid + '</ul>'
            : "") +
        '</section>' +
      '</div>' +
    '</div>'
  );
}

const scoreCategoryLabels = {
  icpFit: "ICP Fit",
  marketingOpportunity: "Marketing Opportunity",
  highValueServices: "High-Value Services",
  growthSignals: "Growth Signals",
  competitiveOpportunity: "Competitive Opportunity",
  digitalWeakness: "Digital Weakness",
  decisionMakerAccess: "Decision-Maker Access"
};

function renderScoring(scoring, index, threshold = 65) {
  const breakdown = scoring.breakdown || {};

  const categories = Object.entries(breakdown)
    .map(([key, category]) => {
      const score = Number(category.score || 0);
      const max = Number(category.max || 0);
      const percent = max > 0 ? Math.round((score / max) * 100) : 0;
      const reasons = (category.reasons || [])
        .map((reason) => "<li>" + escapeHtml(reason) + "</li>")
        .join("");

      return (
        '<article class="score-category">' +
          '<div class="score-category-head">' +
            "<strong>" +
              escapeHtml(scoreCategoryLabels[key] || key) +
            "</strong>" +
            "<span>" + score + " / " + max + "</span>" +
          "</div>" +
          '<div class="score-bar"><span style="width:' +
            Math.max(0, Math.min(100, percent)) +
            '%"></span></div>' +
          '<ul class="score-reasons">' + reasons + "</ul>" +
        "</article>"
      );
    })
    .join("");

  return (
    '<div class="scoring-panel">' +
      '<div class="scoring-hero">' +
        '<div class="opportunity-score">' +
          "<strong>" + Number(scoring.marketingOpportunityScore || 0) + "</strong>" +
          "<small>Marketing Opportunity Score</small>" +
        "</div>" +
        '<div class="score-summary">' +
          '<p class="eyebrow">Agent 3 deterministic score</p>' +
          "<h4>" + escapeHtml(scoring.tier) + "</h4>" +
          "<p>" + escapeHtml(scoring.nextAction) + "</p>" +
          "<small>Formula: " + escapeHtml(scoring.scoreVersion) + "</small>" +
        "</div>" +
      "</div>" +
      '<div class="score-breakdown">' + categories + "</div>" +
      '<div class="score-actions">' +
        (Number(scoring.marketingOpportunityScore || 0) >= threshold
          ? '<button class="details-button contact-resolve-button" type="button" data-contact-resolve="' +
            index +
            '">Resolve Decision Maker</button>'
          : '<p class="threshold-note">Agent 4 unlocks at ' +
            threshold +
            '+. This prospect scored ' +
            Number(scoring.marketingOpportunityScore || 0) +
            '.</p>') +
      '</div>' +
      '<div id="contact-resolution-' + index + '" class="contact-resolution-output" hidden></div>' +
    "</div>"
  );
}

function renderEnrichment(enrichment, index) {
  return (
    '<div class="enrichment-panel">' +
      '<div class="enrichment-heading">' +
        "<div>" +
          '<p class="eyebrow">Agent 2 enrichment</p>' +
          "<h4>" + escapeHtml(enrichment.opportunitySummary) + "</h4>" +
        "</div>" +
        '<div class="enrichment-score">' +
          "<strong>" + Number(enrichment.enrichmentConfidence || 0) + "</strong>" +
          "<small>enrichment confidence</small>" +
        "</div>" +
      "</div>" +

      '<p class="enrichment-summary">' +
        escapeHtml(enrichment.businessSummary) +
      "</p>" +
      '<div class="enrichment-actions">' +
        '<button class="details-button score-button" type="button" data-score="' +
          index +
          '">Calculate Opportunity Score</button>' +
      "</div>" +
      '<div id="scoring-' + index + '" class="prospect-scoring" hidden></div>' +

      '<div class="enrichment-grid">' +
        '<section>' +
          "<h5>Decision-makers</h5>" +
          renderDecisionMakers(enrichment.decisionMakers) +
        "</section>" +
        '<section>' +
          "<h5>Contact paths</h5>" +
          renderContactPaths(enrichment.contactPaths) +
        "</section>" +
        '<section>' +
          "<h5>Growth signals</h5>" +
          renderSignalItems(enrichment.growthSignals, "growth") +
        "</section>" +
        '<section>' +
          "<h5>Marketing findings</h5>" +
          renderSignalItems(enrichment.marketingSignals, "marketing") +
        "</section>" +
      "</div>" +
    "</div>"
  );
}

function renderProspect(prospect, index, industry) {
  const website = safeUrl(prospect.website);
  const email = safeEmail(prospect.email);
  const reasons = (prospect.fitReasons || [])
    .slice(0, 4)
    .map((reason) => "<li>" + escapeHtml(reason) + "</li>")
    .join("");

  const subindustry = prospect.subindustry
    ? " • " + escapeHtml(prospect.subindustry)
    : "";

  return (
    '<article class="prospect-card">' +
      '<div class="prospect-main">' +
        '<div class="score" title="Discovery confidence, not a final sales score">' +
          "<div>" +
            "<strong>" + Number(prospect.discoveryConfidence || 0) + "</strong>" +
            "<small>confidence</small>" +
          "</div>" +
        "</div>" +

        '<div class="prospect-copy">' +
          "<h3>" + escapeHtml(prospect.name) + "</h3>" +
          '<p class="prospect-meta">' +
            escapeHtml(prospect.city) + ", " + escapeHtml(prospect.state) +
            subindustry +
            " • " + escapeHtml(companyTypeLabel(prospect.companyType, industry)) +
            " • Type confidence " +
            Number(prospect.companyTypeConfidence || 0) +
            "%" +
          "</p>" +

          '<div class="tags">' +
            renderCapabilities(prospect.capabilities, industry) +
          "</div>" +

          '<ul class="fit-reasons">' + reasons + "</ul>" +
        "</div>" +

        '<div class="card-actions">' +
          (website !== "#"
            ? '<a class="website-link" href="' +
              website +
              '" target="_blank" rel="noopener noreferrer">Website ↗</a>'
            : "") +
          (email
            ? '<a class="details-button" href="mailto:' +
              escapeHtml(email) +
              '">Email</a>'
            : "") +
          '<button class="details-button enrich-button" type="button" data-enrich="' +
            index +
            '">Enrich Prospect</button>' +
          '<button class="details-button" type="button" data-details="' +
            index +
            '" aria-expanded="false">Evidence</button>' +
        "</div>" +
      "</div>" +

      '<div id="enrichment-' + index + '" class="prospect-enrichment" hidden></div>' +
      '<div id="details-' + index + '" class="prospect-details" hidden>' +
        '<div class="detail-grid">' +
          '<div class="detail-block">' +
            "<h4>Business details</h4>" +
            "<p>" +
              (prospect.phone
                ? "Phone: " + escapeHtml(prospect.phone) + "<br>"
                : "") +
              (email
                ? 'Email: <a href="mailto:' + escapeHtml(email) + '">' +
                  escapeHtml(email) + "</a><br>"
                : "") +
              "Company type: " +
              escapeHtml(companyTypeLabel(prospect.companyType, industry)) +
              "<br>" +
              (prospect.subindustry
                ? "Specialty: " + escapeHtml(prospect.subindustry) + "<br>"
                : "") +
              "Discovery confidence: " +
              Number(prospect.discoveryConfidence || 0) +
              "%<br>" +
              "Company-type confidence: " +
              Number(prospect.companyTypeConfidence || 0) +
              "%" +
            "</p>" +
          "</div>" +
          '<div class="detail-block">' +
            "<h4>Public evidence</h4>" +
            '<ol class="evidence-list">' +
              renderEvidence(prospect.evidence) +
            "</ol>" +
          "</div>" +
        "</div>" +
      "</div>" +
    "</article>"
  );
}

function startLoadingMessages(industryLabel) {
  const messages = [
    [
      "Searching " + industryLabel + "…",
      "Looking for credible businesses that fit the selected market."
    ],
    [
      "Checking first-party websites…",
      "Verifying specialties, capabilities, location, and public evidence."
    ],
    [
      "Filtering weak matches…",
      "Removing directories, duplicates, poor-fit companies, and uncertain candidates."
    ],
    [
      "Building your shortlist…",
      "Organizing the strongest evidence-backed prospects."
    ]
  ];

  let index = 0;

  const update = () => {
    const [title, message] = messages[index % messages.length];
    loadingTitle.textContent = title;
    loadingMessage.textContent = message;
    index += 1;
  };

  update();
  loadingTimer = setInterval(update, 3200);
}

function stopLoadingMessages() {
  if (loadingTimer) clearInterval(loadingTimer);
}

function showResults(payload) {
  const discovery = payload.discovery;
  lastDiscovery = discovery;

  const industry = industries.find((item) => item.id === discovery.industry);
  lastProspects = [...(discovery.prospects || [])].sort(
    (a, b) =>
      (b.discoveryConfidence || 0) - (a.discoveryConfidence || 0)
  );

  const industryLabel = industry?.label || discovery.industry;

  resultsTitle.textContent =
    lastProspects.length +
    (lastProspects.length === 1 ? " prospect" : " prospects") +
    " • " +
    industryLabel +
    " • " +
    discovery.market;

  resultsSummary.textContent =
    discovery.searchSummary ||
    "Evidence-backed candidates within approximately " +
      discovery.radiusMiles +
      " miles.";

  resultsList.innerHTML = lastProspects.length
    ? lastProspects
        .map((prospect, index) => renderProspect(prospect, index, industry))
        .join("")
    : (
      '<div class="message-card">' +
        "<h2>No confident matches found.</h2>" +
        "<p>Try a larger radius or broaden the capability priorities.</p>" +
      "</div>"
    );

  if (payload.persistence?.ok === false) {
    persistenceNote.hidden = false;
    const category = payload.persistence?.diagnostic?.category;
    persistenceNote.textContent =
      "The search completed, but these prospects were not saved to the database." +
      (category ? " Database diagnostic: " + category + "." : "") +
      " Run the Supabase reconciliation migration and retry.";
  } else {
    persistenceNote.hidden = true;
  }

  setView("results");
}

function showError(message) {
  errorMessage.textContent = message || "Something went wrong.";
  setView("error");
}

async function loadIndustries() {
  try {
    const response = await fetch("/api/industries");
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.industries)) {
      throw new Error("Industry configuration could not be loaded.");
    }

    industries = data.industries;

    industrySelect.innerHTML = industries
      .map(
        (industry) =>
          '<option value="' +
          escapeHtml(industry.id) +
          '">' +
          escapeHtml(industry.label) +
          "</option>"
      )
      .join("");

    industrySelect.value =
      industries.find((item) => item.id === "dental")?.id ||
      industries[0]?.id ||
      "";

    renderIndustryControls();
  } catch (error) {
    industrySelect.innerHTML =
      '<option value="">Unable to load industries</option>';
    showError(error.message);
  }
}

industrySelect.addEventListener("change", () => {
  renderIndustryControls();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const industry = currentIndustry();

  if (!industry) {
    showError("Choose an industry before searching.");
    return;
  }

  const payload = {
    industry: industry.id,
    market: document.querySelector("#market").value.trim(),
    radiusMiles: Number(document.querySelector("#radius").value),
    maxResults: Number(document.querySelector("#max-results").value),
    priorities: selectedValues("priority"),
    companyTypes: selectedValues("companyType")
  };

  button.disabled = true;
  setView("loading");
  startLoadingMessages(industry.label);

  try {
    const response = await fetch("/api/public/discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const stage = data.diagnostic?.stage
        ? " (" + data.diagnostic.stage + ")"
        : "";
      throw new Error(
        (data.error || "The search could not be completed.") + stage
      );
    }

    showResults(data);
  } catch (error) {
    showError(error.message);
  } finally {
    stopLoadingMessages();
    button.disabled = false;
  }
});

resultsList.addEventListener("click", async (event) => {
  const copyTrigger = event.target.closest("[data-copy-outreach]");

  if (copyTrigger) {
    const index = Number(copyTrigger.dataset.copyIndex);
    const key = copyTrigger.dataset.copyOutreach;
    const prospect = lastProspects[index];
    const text = outreachTextForKey(prospect?.outreach, key);

    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const previous = copyTrigger.textContent;
      copyTrigger.textContent = "Copied";
      setTimeout(() => {
        copyTrigger.textContent = previous;
      }, 1200);
    } catch {
      copyTrigger.textContent = "Copy failed";
    }

    return;
  }

  const outreachTrigger = event.target.closest("[data-outreach-compose]");

  if (outreachTrigger) {
    const index = Number(outreachTrigger.dataset.outreachCompose);
    const prospect = lastProspects[index];
    const container = document.querySelector("#outreach-output-" + index);

    if (
      !prospect?.enrichment ||
      !prospect?.scoring ||
      !prospect?.contactResolution ||
      !lastDiscovery ||
      !container
    ) {
      return;
    }

    outreachTrigger.disabled = true;
    outreachTrigger.textContent = "Creating Drafts…";
    container.hidden = false;
    container.innerHTML =
      '<div class="outreach-loading"><div class="loader"></div><p>Agent 5 is composing evidence-based outreach drafts…</p></div>';

    try {
      const response = await fetch("/api/public/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: lastDiscovery.industry,
          prospect: {
            ...prospect,
            market: lastDiscovery.market,
            radiusMiles: lastDiscovery.radiusMiles
          },
          enrichment: prospect.enrichment,
          scoring: prospect.scoring,
          contactResolution: prospect.contactResolution
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const stage = data.diagnostic?.stage
          ? " (" + data.diagnostic.stage + ")"
          : "";

        throw new Error(
          (data.error || "Outreach drafts could not be created.") + stage
        );
      }

      prospect.outreach = data.outreach;
      container.innerHTML =
        renderOutreachPackage(data.outreach, index) +
        (data.persistence?.ok === false
          ? '<div class="persistence-note">Outreach drafts were created, but they were not saved to Supabase.' +
            (data.persistence?.diagnostic?.category
              ? " Database diagnostic: " + escapeHtml(data.persistence.diagnostic.category) + "."
              : "") +
            " Run migration 008 and retry.</div>"
          : "");

      outreachTrigger.textContent = "Drafts Created";
      outreachTrigger.classList.add("created");
      outreachTrigger.disabled = false;
    } catch (error) {
      container.innerHTML =
        '<div class="persistence-note">' +
        escapeHtml(error.message) +
        "</div>";
      outreachTrigger.textContent = "Retry Outreach Drafts";
      outreachTrigger.disabled = false;
    }

    return;
  }

  const contactTrigger = event.target.closest("[data-contact-resolve]");

  if (contactTrigger) {
    const index = Number(contactTrigger.dataset.contactResolve);
    const prospect = lastProspects[index];
    const container = document.querySelector("#contact-resolution-" + index);

    if (
      !prospect?.enrichment ||
      !prospect?.scoring ||
      !lastDiscovery ||
      !container
    ) {
      return;
    }

    contactTrigger.disabled = true;
    contactTrigger.textContent = "Resolving…";
    container.hidden = false;
    container.innerHTML =
      '<div class="contact-resolution-loading"><div class="loader"></div><p>Agent 4 is verifying the best decision-maker and business contact routes…</p></div>';

    try {
      const response = await fetch("/api/public/contact-resolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: lastDiscovery.industry,
          prospect: {
            ...prospect,
            market: lastDiscovery.market,
            radiusMiles: lastDiscovery.radiusMiles
          },
          enrichment: prospect.enrichment,
          scoring: prospect.scoring
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const stage = data.diagnostic?.stage
          ? " (" + data.diagnostic.stage + ")"
          : "";

        throw new Error(
          (data.error || "Contact resolution could not be completed.") + stage
        );
      }

      prospect.contactResolution = data.resolution;
      container.innerHTML =
        renderContactResolution(data.resolution, index) +
        (data.persistence?.ok === false
          ? '<div class="persistence-note">Contact resolution completed, but it was not saved to Supabase.' +
            (data.persistence?.diagnostic?.category
              ? " Database diagnostic: " + escapeHtml(data.persistence.diagnostic.category) + "."
              : "") +
            " Run migration 007 and retry.</div>"
          : "");

      contactTrigger.textContent = "Contact Resolved";
      contactTrigger.classList.add("resolved");
      contactTrigger.disabled = false;

      const resolvedEmail =
        safeEmail(data.resolution.primaryDecisionMaker?.publicBusinessEmail) ||
        safeEmail(
          (data.resolution.contactPaths || []).find(
            (path) => path.type === "email" && safeEmail(path.value)
          )?.value
        );

      if (resolvedEmail && !prospect.email) {
        prospect.email = resolvedEmail;
      }
    } catch (error) {
      container.innerHTML =
        '<div class="persistence-note">' +
        escapeHtml(error.message) +
        "</div>";
      contactTrigger.textContent = "Retry Contact Resolution";
      contactTrigger.disabled = false;
    }

    return;
  }

  const scoreTrigger = event.target.closest("[data-score]");

  if (scoreTrigger) {
    const index = Number(scoreTrigger.dataset.score);
    const prospect = lastProspects[index];
    const container = document.querySelector("#scoring-" + index);

    if (!prospect?.enrichment || !lastDiscovery || !container) {
      return;
    }

    scoreTrigger.disabled = true;
    scoreTrigger.textContent = "Scoring…";
    container.hidden = false;
    container.innerHTML =
      '<div class="score-loading"><p>Applying deterministic scoring rules…</p></div>';

    try {
      const response = await fetch("/api/public/scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: lastDiscovery.industry,
          prospect: {
            ...prospect,
            market: lastDiscovery.market,
            radiusMiles: lastDiscovery.radiusMiles
          },
          enrichment: prospect.enrichment
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || "Opportunity scoring could not be completed."
        );
      }

      prospect.scoring = data.scoring;
      prospect.contactResolutionMinimumScore =
        Number(data.contactResolutionMinimumScore || 65);
      container.innerHTML =
        renderScoring(
          data.scoring,
          index,
          prospect.contactResolutionMinimumScore
        ) +
        (data.persistence?.ok === false
          ? '<div class="persistence-note">Score calculated, but it was not saved to Supabase.' +
            (data.persistence?.diagnostic?.category
              ? " Database diagnostic: " + escapeHtml(data.persistence.diagnostic.category) + "."
              : "") +
            " Run migration 006 and retry.</div>"
          : "");

      scoreTrigger.textContent = "Recalculate Score";
      scoreTrigger.classList.add("scored");
      scoreTrigger.disabled = false;
    } catch (error) {
      container.innerHTML =
        '<div class="persistence-note">' +
        escapeHtml(error.message) +
        "</div>";
      scoreTrigger.textContent = "Retry Score";
      scoreTrigger.disabled = false;
    }

    return;
  }

  const enrichTrigger = event.target.closest("[data-enrich]");

  if (enrichTrigger) {
    const index = Number(enrichTrigger.dataset.enrich);
    const prospect = lastProspects[index];
    const container = document.querySelector("#enrichment-" + index);

    if (!prospect || !lastDiscovery || !container) return;

    enrichTrigger.disabled = true;
    enrichTrigger.textContent = "Enriching…";
    container.hidden = false;
    container.innerHTML =
      '<div class="enrichment-loading"><div class="loader"></div><p>Agent 2 is researching this company…</p></div>';

    try {
      const response = await fetch("/api/public/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry: lastDiscovery.industry,
          prospect: {
            ...prospect,
            market: lastDiscovery.market,
            radiusMiles: lastDiscovery.radiusMiles
          }
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const stage = data.diagnostic?.stage
          ? " (" + data.diagnostic.stage + ")"
          : "";

        throw new Error(
          (data.error || "Enrichment could not be completed.") + stage
        );
      }

      prospect.enrichment = data.enrichment;

      container.innerHTML =
        renderEnrichment(data.enrichment, index) +
        (data.persistence?.ok === false
          ? '<div class="persistence-note">Enrichment completed, but it was not saved to Supabase.' +
            (data.persistence?.diagnostic?.category
              ? " Database diagnostic: " + escapeHtml(data.persistence.diagnostic.category) + "."
              : "") +
            " Run migration 006 and retry.</div>"
          : "");
      enrichTrigger.textContent = "Enriched";
      enrichTrigger.classList.add("enriched");
      enrichTrigger.disabled = false;

      const publicEmail = (data.enrichment.contactPaths || []).find(
        (path) => path.type === "email" && safeEmail(path.value)
      );

      if (publicEmail && !prospect.email) {
        prospect.email = publicEmail.value;
      }
    } catch (error) {
      container.innerHTML =
        '<div class="persistence-note">' +
        escapeHtml(error.message) +
        "</div>";
      enrichTrigger.textContent = "Retry Enrichment";
      enrichTrigger.disabled = false;
    }

    return;
  }

  const trigger = event.target.closest("[data-details]");
  if (!trigger) return;

  const index = trigger.dataset.details;
  const details = document.querySelector("#details-" + index);
  const expanded = trigger.getAttribute("aria-expanded") === "true";

  trigger.setAttribute("aria-expanded", String(!expanded));
  trigger.textContent = expanded ? "Evidence" : "Hide evidence";
  details.hidden = expanded;
});

tryAgainButton.addEventListener("click", () => {
  setView("empty");
  document.querySelector("#market").focus();
});

exportButton.addEventListener("click", () => {
  if (!lastProspects.length || !lastDiscovery) return;

  const industry =
    industries.find((item) => item.id === lastDiscovery.industry) || null;

  const headers = [
    "Industry",
    "Name",
    "Website",
    "City",
    "State",
    "Phone",
    "Email",
    "Subindustry",
    "Company Type",
    "Discovery Confidence",
    "Company Type Confidence",
    "Capabilities",
    "Fit Reasons"
  ];

  const rows = lastProspects.map((prospect) => [
    industry?.label || lastDiscovery.industry,
    prospect.name,
    prospect.website,
    prospect.city,
    prospect.state,
    prospect.phone || "",
    prospect.email || "",
    prospect.subindustry || "",
    companyTypeLabel(prospect.companyType, industry),
    prospect.discoveryConfidence,
    prospect.companyTypeConfidence,
    (prospect.capabilities || [])
      .map((id) => capabilityLabel(id, industry))
      .join("; "),
    (prospect.fitReasons || []).join("; ")
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map(
          (value) =>
            '"' + String(value ?? "").replaceAll('"', '""') + '"'
        )
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    (lastDiscovery.industry || "prospects") + "-prospects.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

loadIndustries();

const form = document.querySelector("#search-form");
const button = document.querySelector("#search-button");
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

let lastProspects = [];
let loadingTimer;

const loadingMessages = [
  ["Searching the market…", "Looking for credible dental practice candidates."],
  ["Checking practice websites…", "Verifying services, location, and first-party evidence."],
  ["Filtering weak matches…", "Removing chains, directories, duplicates, and uncertain candidates."],
  ["Building your shortlist…", "Organizing the strongest evidence-backed prospects."]
];

const serviceLabels = {
  implants: "Implants",
  fullMouth: "Full-mouth",
  cosmetic: "Cosmetic",
  clearAligners: "Clear aligners",
  sedation: "Sedation"
};

const practiceTypeLabels = {
  independent: "Independent",
  small_group: "Small group",
  unknown: "Ownership unclear"
};

function setView(view) {
  emptyState.hidden = view !== "empty";
  loadingState.hidden = view !== "loading";
  errorState.hidden = view !== "error";
  resultsState.hidden = view !== "results";
}

function startLoadingMessages() {
  let index = 0;
  const update = () => {
    const [title, message] = loadingMessages[index % loadingMessages.length];
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

function selectedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
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

function renderServices(services = {}) {
  return Object.entries(serviceLabels)
    .map(([key, label]) =>
      `<span class="tag ${services[key] ? "active" : ""}">${escapeHtml(label)}</span>`
    )
    .join("");
}

function renderEvidence(evidence = []) {
  return evidence
    .map((item) => {
      const href = safeUrl(item.url);
      return `
        <li>
          ${escapeHtml(item.fact)}
          ${href !== "#" ? `<br><a href="${href}" target="_blank" rel="noopener noreferrer">View source</a>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderProspect(prospect, index) {
  const website = safeUrl(prospect.website);
  const reasons = (prospect.fitReasons || [])
    .slice(0, 3)
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");

  return `
    <article class="prospect-card">
      <div class="prospect-main">
        <div class="score" title="Discovery confidence, not a final sales score">
          <div>
            <strong>${Number(prospect.discoveryConfidence || 0)}</strong>
            <small>confidence</small>
          </div>
        </div>

        <div class="prospect-copy">
          <h3>${escapeHtml(prospect.name)}</h3>
          <p class="prospect-meta">
            ${escapeHtml(prospect.city)}, ${escapeHtml(prospect.state)}
            • ${escapeHtml(practiceTypeLabels[prospect.practiceType] || "Practice")}
            • Independent confidence ${Number(prospect.independenceConfidence || 0)}%
          </p>

          <div class="tags">${renderServices(prospect.services)}</div>

          <ul class="fit-reasons">${reasons}</ul>
        </div>

        <div class="card-actions">
          ${website !== "#" ? `<a class="website-link" href="${website}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ""}
          <button class="details-button" type="button" data-details="${index}" aria-expanded="false">Evidence</button>
        </div>
      </div>

      <div id="details-${index}" class="prospect-details" hidden>
        <div class="detail-grid">
          <div class="detail-block">
            <h4>Business details</h4>
            <p>
              ${prospect.phone ? `Phone: ${escapeHtml(prospect.phone)}<br>` : ""}
              Practice type: ${escapeHtml(practiceTypeLabels[prospect.practiceType] || prospect.practiceType || "Unknown")}<br>
              Discovery confidence: ${Number(prospect.discoveryConfidence || 0)}%<br>
              Independence confidence: ${Number(prospect.independenceConfidence || 0)}%
            </p>
          </div>
          <div class="detail-block">
            <h4>Public evidence</h4>
            <ol class="evidence-list">${renderEvidence(prospect.evidence)}</ol>
          </div>
        </div>
      </div>
    </article>
  `;
}

function showResults(payload) {
  const discovery = payload.discovery;
  lastProspects = [...(discovery.prospects || [])]
    .sort((a, b) => (b.discoveryConfidence || 0) - (a.discoveryConfidence || 0));

  resultsTitle.textContent =
    lastProspects.length === 1
      ? `1 prospect in ${discovery.market}`
      : `${lastProspects.length} prospects in ${discovery.market}`;

  resultsSummary.textContent =
    discovery.searchSummary ||
    `Evidence-backed candidates within approximately ${discovery.radiusMiles} miles.`;

  resultsList.innerHTML = lastProspects.length
    ? lastProspects.map(renderProspect).join("")
    : `
      <div class="message-card">
        <h2>No confident matches found.</h2>
        <p>Try a larger radius or broaden the service priorities.</p>
      </div>
    `;

  if (payload.persistence?.ok === false) {
    persistenceNote.hidden = false;
    persistenceNote.textContent =
      "The search completed, but these prospects were not saved to the database. The public results are still usable.";
  } else {
    persistenceNote.hidden = true;
  }

  setView("results");
}

function showError(message) {
  errorMessage.textContent = message || "Something went wrong.";
  setView("error");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    market: document.querySelector("#market").value.trim(),
    radiusMiles: Number(document.querySelector("#radius").value),
    maxResults: Number(document.querySelector("#max-results").value),
    priorities: selectedValues("priority"),
    practiceTypes: selectedValues("practiceType")
  };

  button.disabled = true;
  setView("loading");
  startLoadingMessages();

  try {
    const response = await fetch("/api/public/dental-discovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "The search could not be completed.");
    }

    showResults(data);
  } catch (error) {
    showError(error.message);
  } finally {
    stopLoadingMessages();
    button.disabled = false;
  }
});

resultsList.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-details]");
  if (!trigger) return;

  const index = trigger.dataset.details;
  const details = document.querySelector(`#details-${index}`);
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
  if (!lastProspects.length) return;

  const headers = [
    "Name",
    "Website",
    "City",
    "State",
    "Phone",
    "Practice Type",
    "Discovery Confidence",
    "Independence Confidence",
    "Services",
    "Fit Reasons"
  ];

  const rows = lastProspects.map((prospect) => {
    const services = Object.entries(prospect.services || {})
      .filter(([, active]) => active)
      .map(([key]) => serviceLabels[key] || key)
      .join("; ");

    return [
      prospect.name,
      prospect.website,
      prospect.city,
      prospect.state,
      prospect.phone || "",
      practiceTypeLabels[prospect.practiceType] || prospect.practiceType,
      prospect.discoveryConfidence,
      prospect.independenceConfidence,
      services,
      (prospect.fitReasons || []).join("; ")
    ];
  });

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "dental-prospects.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
});

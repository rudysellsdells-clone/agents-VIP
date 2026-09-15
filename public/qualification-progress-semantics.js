(() => {
  const label = (value) => String(value || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

  function updateProgress(job) {
    const panel = document.querySelector("#qualification-job");
    if (!panel || !job) return;

    const counts = job.counts || {};
    const total = Number(job.total_items || job.items?.length || 0);
    const processed =
      Number(counts.completed || 0) +
      Number(counts.stopped || 0) +
      Number(counts.partial || 0) +
      Number(counts.failed || 0);
    const percent = total > 0
      ? Math.round((processed / total) * 100)
      : 0;

    const percentNode = panel.querySelector(".qualification-percent");
    if (percentNode) {
      percentNode.textContent = percent + "%";
      percentNode.title = "Processing completion, not success rate";
    }

    const progressBar = panel.querySelector(".qualification-progress span");
    if (progressBar) {
      progressBar.style.width = Math.max(0, Math.min(100, percent)) + "%";
    }

    const summary = panel.querySelector(".qualification-head p:not(.eyebrow)");
    if (summary) {
      summary.textContent =
        processed +
        " of " +
        total +
        " prospects processed • " +
        label(job.status);
    }

    let note = panel.querySelector(".qualification-progress-note");
    if (!note) {
      note = document.createElement("p");
      note.className = "qualification-progress-note";
      panel.querySelector(".qualification-progress")?.after(note);
    }
    if (note) {
      note.textContent =
        "Progress shows records processed. Completed, partial, stopped, and failed are reported separately below.";
    }
  }

  const style = document.createElement("style");
  style.textContent =
    ".qualification-progress-note{margin:7px 0 0;color:#607a9c;font-size:9px;line-height:1.4}";
  document.head.appendChild(style);

  const priorFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await priorFetch(...args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (/\/api\/public\/qualification-jobs\/[0-9a-f-]+$/i.test(url)) {
        const clone = response.clone();
        clone.json().then((data) => {
          if (data?.job) setTimeout(() => updateProgress(data.job), 120);
        }).catch(() => {});
      }
    } catch {}
    return response;
  };
})();

import { enrichProspect } from "../agents/prospect-enrichment.js";
import { scoreProspect } from "../agents/prospect-scoring.js";
import { resolveProspectContact } from "../agents/contact-resolution.js";
import { composeOutreach } from "../agents/outreach-composer.js";
import {
  getQualificationJob,
  listResumableQualificationJobs,
  updateQualificationJob,
  updateQualificationJobItem,
  upsertProspectEnrichment,
  saveProspectScore,
  saveContactResolution,
  saveOutreachPackage
} from "./supabase.js";

const activeJobs = new Set();

const TERMINAL_ITEM_STATUSES = new Set([
  "COMPLETED",
  "STOPPED",
  "FAILED"
]);

function workerConcurrency() {
  return Math.max(
    1,
    Math.min(5, Number(process.env.QUALIFICATION_CONCURRENCY || 2))
  );
}

function maxAttempts() {
  return Math.max(
    1,
    Math.min(3, Number(process.env.QUALIFICATION_MAX_ATTEMPTS || 2))
  );
}

function safeError(error) {
  const message = String(error?.message || "Unknown qualification error.");
  return message.slice(0, 1200);
}

function aggregateCounts(items) {
  const counts = {
    queued: 0,
    running: 0,
    completed: 0,
    stopped: 0,
    failed: 0,
    enriched: 0,
    scored: 0,
    contactResolved: 0,
    outreachDrafted: 0
  };

  for (const item of items) {
    const status = String(item.status || "").toUpperCase();
    const stage = String(item.stage || "").toUpperCase();

    if (status === "QUEUED") counts.queued += 1;
    if (status === "RUNNING") counts.running += 1;
    if (status === "COMPLETED") counts.completed += 1;
    if (status === "STOPPED") counts.stopped += 1;
    if (status === "FAILED") counts.failed += 1;

    if (item.enrichment) {
      counts.enriched += 1;
    }

    if (item.scoring) {
      counts.scored += 1;
    }

    if (item.contact_resolution) {
      counts.contactResolved += 1;
    }

    if (item.outreach_package) {
      counts.outreachDrafted += 1;
    }
  }

  return counts;
}

async function refreshJobCounts(jobId) {
  const job = await getQualificationJob(jobId);
  if (!job) return null;

  const counts = aggregateCounts(job.items || []);
  const total = job.items?.length || 0;
  const terminal =
    counts.completed + counts.stopped + counts.failed;

  const patch = { counts };

  if (total > 0 && terminal === total) {
    patch.status = counts.failed === total ? "FAILED" : "COMPLETED";
    patch.completed_at = new Date().toISOString();
  }

  return updateQualificationJob(jobId, patch);
}

function prospectFromItem(item) {
  const snapshot =
    item.prospect_snapshot && typeof item.prospect_snapshot === "object"
      ? item.prospect_snapshot
      : {};

  return {
    ...snapshot,
    name: snapshot.name || item.company_name,
    website: snapshot.website || item.website
  };
}

async function processItem(job, item) {
  if (TERMINAL_ITEM_STATUSES.has(item.status)) return;

  const prospect = prospectFromItem(item);
  const industry = item.industry || job.industry;
  const now = new Date().toISOString();

  const attempt = Math.min(10, Number(item.attempts || 0) + 1);
  let currentStage = String(item.stage || "ENRICHMENT_QUEUED");

  await updateQualificationJobItem(item.id, {
    status: "RUNNING",
    attempts: attempt,
    started_at: item.started_at || now,
    last_error: null
  });

  try {
    let enrichment = item.enrichment || null;
    let scoring = item.scoring || null;
    let contactResolution = item.contact_resolution || null;

    const stage = currentStage;

    if (
      !enrichment ||
      ["ENRICHMENT_QUEUED", "ENRICHING"].includes(stage)
    ) {
      currentStage = "ENRICHING";
      await updateQualificationJobItem(item.id, {
        stage: currentStage
      });

      enrichment = await enrichProspect({ industry, prospect });
      await upsertProspectEnrichment(prospect, enrichment);

      await updateQualificationJobItem(item.id, {
        stage: "ENRICHED",
        enrichment
      });
    }

    if (
      !scoring ||
      ["ENRICHED", "SCORING"].includes(stage)
    ) {
      currentStage = "SCORING";
      await updateQualificationJobItem(item.id, {
        stage: currentStage
      });

      scoring = scoreProspect({ industry, prospect, enrichment });
      await saveProspectScore(prospect, scoring);

      await updateQualificationJobItem(item.id, {
        stage: "SCORED",
        scoring
      });
    }

    if (
      Number(scoring.marketingOpportunityScore) <
      Number(job.contact_score_threshold)
    ) {
      await updateQualificationJobItem(item.id, {
        status: "STOPPED",
        stage: "STOPPED_BELOW_THRESHOLD",
        scoring,
        completed_at: new Date().toISOString()
      });
      return;
    }

    if (
      !contactResolution ||
      ["SCORED", "CONTACT_RESOLVING"].includes(stage)
    ) {
      currentStage = "CONTACT_RESOLVING";
      await updateQualificationJobItem(item.id, {
        stage: currentStage
      });

      contactResolution = await resolveProspectContact({
        industry,
        prospect,
        enrichment,
        scoring
      });

      await saveContactResolution(prospect, contactResolution);

      await updateQualificationJobItem(item.id, {
        stage: "CONTACT_RESOLVED",
        contact_resolution: contactResolution
      });
    }

    const shouldDraft =
      Boolean(job.auto_draft_priority) &&
      Number(scoring.marketingOpportunityScore) >=
        Number(job.draft_score_threshold);

    if (shouldDraft) {
      currentStage = "OUTREACH_DRAFTING";
      await updateQualificationJobItem(item.id, {
        stage: currentStage
      });

      const outreach = await composeOutreach({
        industry,
        prospect,
        enrichment,
        scoring,
        contactResolution
      });

      await saveOutreachPackage(prospect, outreach);

      await updateQualificationJobItem(item.id, {
        status: "COMPLETED",
        stage: "OUTREACH_DRAFTED",
        outreach_package: outreach,
        completed_at: new Date().toISOString()
      });
      return;
    }

    await updateQualificationJobItem(item.id, {
      status: "COMPLETED",
      stage: "CONTACT_RESOLVED",
      completed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Qualification item failed:",
      item.company_name,
      error
    );

    const retryStage = {
      ENRICHING: "ENRICHMENT_QUEUED",
      SCORING: "ENRICHED",
      CONTACT_RESOLVING: "SCORED",
      OUTREACH_DRAFTING: "CONTACT_RESOLVED"
    }[currentStage] || "ENRICHMENT_QUEUED";

    const canRetry = attempt < maxAttempts();

    await updateQualificationJobItem(item.id, {
      status: canRetry ? "QUEUED" : "FAILED",
      stage: canRetry ? retryStage : "FAILED",
      last_error: safeError(error),
      completed_at: canRetry ? null : new Date().toISOString()
    }).catch(() => {});
  }
}

async function runQualificationJob(jobId) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  try {
    let job = await getQualificationJob(jobId);
    if (!job) return;

    if (job.status === "COMPLETED" || job.status === "FAILED") return;

    await updateQualificationJob(jobId, {
      status: "RUNNING",
      started_at: job.started_at || new Date().toISOString(),
      last_error: null
    });

    const concurrency = workerConcurrency();

    while (true) {
      job = await getQualificationJob(jobId);

      const pending = (job.items || []).filter(
        (item) => !TERMINAL_ITEM_STATUSES.has(item.status)
      );

      if (pending.length === 0) break;

      for (let i = 0; i < pending.length; i += concurrency) {
        const batch = pending.slice(i, i + concurrency);

        await Promise.allSettled(
          batch.map((item) => processItem(job, item))
        );

        await refreshJobCounts(jobId);
      }
    }

    await refreshJobCounts(jobId);
  } catch (error) {
    console.error("Qualification job failed:", jobId, error);

    await updateQualificationJob(jobId, {
      status: "FAILED",
      last_error: safeError(error),
      completed_at: new Date().toISOString()
    }).catch(() => {});
  } finally {
    activeJobs.delete(jobId);
  }
}

export function startQualificationJob(jobId) {
  if (!jobId || activeJobs.has(jobId)) return false;

  setImmediate(() => {
    runQualificationJob(jobId).catch((error) => {
      console.error("Qualification worker unhandled error:", error);
    });
  });

  return true;
}

export async function resumeQualificationJobs() {
  const jobs = await listResumableQualificationJobs(10);

  for (const job of jobs) {
    startQualificationJob(job.id);
  }

  return jobs.length;
}

export function getQualificationWorkerState() {
  return {
    activeJobs: activeJobs.size,
    concurrency: workerConcurrency(),
    maxAttempts: maxAttempts()
  };
}

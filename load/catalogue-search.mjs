/**
 * Closed-loop baseline for the public catalogue search endpoint.
 *
 * GET /api/catalogues/premium-corporate-essentials/search
 *
 * Read-only. No SLA threshold: the process exits non-zero only when it
 * cannot produce a measurement (bad configuration, or no completed request).
 *
 * BASE_URL, CONCURRENCY, and DURATION_SECONDS override the defaults.
 */

const QUERIES = ["atlas", "TRV", "flask", "a", "zzzz"];
const LIVE_SLUG = "premium-corporate-essentials";
const REQUEST_TIMEOUT_MS = 5_000;

const DEFAULT_BASE_URL = "http://localhost:3001";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_DURATION_SECONDS = 30;

function failConfig(message) {
  console.error(`Configuration error: ${message}`);
  process.exit(1);
}

function readConfig() {
  const baseUrl = process.env.BASE_URL ?? DEFAULT_BASE_URL;
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    failConfig(`BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    failConfig(`BASE_URL must be http or https: ${baseUrl}`);
  }

  const concurrencyText = process.env.CONCURRENCY ?? String(DEFAULT_CONCURRENCY);
  if (!/^[1-9]\d*$/.test(concurrencyText)) {
    failConfig(`CONCURRENCY must be a positive integer, got ${concurrencyText}`);
  }
  const concurrency = Number(concurrencyText);

  const durationText = process.env.DURATION_SECONDS ?? String(DEFAULT_DURATION_SECONDS);
  const durationSeconds = Number(durationText);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    failConfig(`DURATION_SECONDS must be a positive number, got ${durationText}`);
  }

  return { baseUrl: parsedUrl.origin, concurrency, durationSeconds };
}

let queryCursor = 0;

function nextQuery() {
  const query = QUERIES[queryCursor % QUERIES.length];
  queryCursor += 1;
  return query;
}

function searchUrl(baseUrl, query) {
  const url = new URL(`/api/catalogues/${LIVE_SLUG}/search`, baseUrl);
  url.searchParams.set("q", query);
  return url;
}

function errorLabel(error) {
  if (error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `timeout (${REQUEST_TIMEOUT_MS}ms)`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "fetch failed";
}

async function sendSearch(baseUrl, query) {
  const started = performance.now();
  try {
    const response = await fetch(searchUrl(baseUrl, query), {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.arrayBuffer().catch(() => {});
    const latencyMs = performance.now() - started;
    const ok = response.status === 200;
    return {
      latencyMs,
      status: response.status,
      ok,
      error: ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      latencyMs: performance.now() - started,
      status: null,
      ok: false,
      error: errorLabel(error),
    };
  }
}

/**
 * Nearest-rank percentile. Sort ascending, then take the value at
 * rank ceil(p/100 * n) (1-based). With 100 latencies, p95 is the 95th.
 */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[index];
}

function formatMs(value) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)} ms`;
}

function formatCountMap(counts) {
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return ["(none)"];
  return entries.map(([status, count]) => `${status}: ${count}`);
}

async function main() {
  const { baseUrl, concurrency, durationSeconds } = readConfig();
  const target = `${baseUrl}/api/catalogues/${LIVE_SLUG}/search?q=<query>`;

  const warmupErrors = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const query = nextQuery();
      const result = await sendSearch(baseUrl, query);
      if (!result.ok) {
        warmupErrors.push({ query, error: result.error });
      }
    }),
  );

  const samples = [];
  const measurementStarted = performance.now();
  const deadline = Date.now() + durationSeconds * 1000;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < deadline) {
        const query = nextQuery();
        const result = await sendSearch(baseUrl, query);
        samples.push(result);
      }
    }),
  );

  const elapsedSeconds = (performance.now() - measurementStarted) / 1000;
  const total = samples.length;
  const successful = samples.filter((sample) => sample.ok).length;
  const failed = total - successful;

  if (total === 0) {
    console.error("No measured requests completed, so there is no baseline to report.");
    if (warmupErrors.length > 0) {
      console.error("Warmup failures:");
      for (const failure of warmupErrors) {
        console.error(`- q=${failure.query} ${failure.error}`);
      }
    }
    process.exit(1);
  }

  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const statusCounts = new Map();
  const errorCounts = new Map();
  for (const sample of samples) {
    if (sample.status != null) {
      statusCounts.set(sample.status, (statusCounts.get(sample.status) ?? 0) + 1);
    }
    if (!sample.ok) {
      errorCounts.set(sample.error, (errorCounts.get(sample.error) ?? 0) + 1);
    }
  }

  const requestsPerSecond = elapsedSeconds > 0 ? total / elapsedSeconds : null;
  const errorRate = failed / total;

  console.log("LOAD TEST: Catalogue Search");
  console.log("");
  console.log(`Target: ${target}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Duration: ${durationSeconds}s`);
  console.log("");
  console.log("Requests");
  console.log("--------");
  console.log(`Total: ${total}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(
    `Requests/sec: ${requestsPerSecond == null ? "n/a" : requestsPerSecond.toFixed(2)}`,
  );
  console.log(`Error rate: ${(errorRate * 100).toFixed(2)}%`);
  console.log("");
  console.log("Latency");
  console.log("-------");
  console.log(`Min: ${formatMs(latencies[0])}`);
  console.log(`P50: ${formatMs(percentile(latencies, 50))}`);
  console.log(`P95: ${formatMs(percentile(latencies, 95))}`);
  console.log(`P99: ${formatMs(percentile(latencies, 99))}`);
  console.log(`Max: ${formatMs(latencies[latencies.length - 1])}`);
  console.log("");
  console.log("HTTP statuses");
  console.log("-------------");
  for (const line of formatCountMap(statusCounts)) console.log(line);
  console.log("");
  console.log("Errors");
  console.log("------");
  if (warmupErrors.length > 0) {
    console.log(
      `Warmup failures (excluded from the counts above): ${warmupErrors.length} of ${concurrency}`,
    );
    for (const failure of warmupErrors) {
      console.log(`- warmup q=${failure.query} ${failure.error}`);
    }
  } else {
    console.log(`Warmup: ${concurrency}/${concurrency} succeeded (excluded from the counts above).`);
  }
  if (errorCounts.size === 0) {
    console.log("Measured errors: none");
  } else {
    for (const [label, count] of errorCounts) {
      console.log(`- ${label}: ${count}`);
    }
  }
  console.log("");
  console.log(
    "Note: This is a local baseline against the seeded eight-product catalogue. No SLA is defined by the assessment.",
  );
}

await main();

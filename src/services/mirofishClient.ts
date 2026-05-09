import axios from "axios";
import { config } from "../config";
import { MiroFishResult, SeedPacket } from "../types";
import { sleep } from "../utils/rateLimit";
import { withRetry } from "../utils/retry";

export interface MiroFishPredictOptions {
  agents: number;
  rounds: number;
  model?: string;
  debugMode?: boolean;
}

export interface MiroFishHealthResult {
  ok: boolean;
  url: string;
  detectedRoute?: string;
  statusCode?: number;
  message: string;
}

export interface MiroFishPredictResponse {
  ok: boolean;
  result?: MiroFishResult;
  error?: string;
  raw?: unknown;
}

interface PrepareFailureDetail {
  step: "prepareSimulation";
  simulationId: string;
  taskId: string;
  status: string;
  entitiesCount?: number;
  entityTypes?: string[];
  error?: string;
  rawPrepareStatus: unknown;
}

interface WorkflowContext {
  projectId: string;
  graphTaskId: string;
  graphId: string;
  simulationId: string;
  prepareTaskId: string;
  reportTaskId: string;
  reportId: string;
  finalRunStatusRaw?: unknown;
  reportGenerateRaw?: unknown;
  reportStatusRaw?: unknown;
  reportBySimulationRaw?: unknown;
  parseSource?: "markdown_content" | "outline.summary";
}

class WorkflowStepError extends Error {
  constructor(public readonly detail: PrepareFailureDetail | Record<string, unknown>, message?: string) {
    super(message ?? "MiroFish workflow step failed");
  }
}

export class MiroFishClient {
  async healthCheck(): Promise<MiroFishHealthResult> {
    const routes = ["/", "/health", "/api/health", "/docs"];
    for (const route of routes) {
      const url = `${config.MIROFISH_URL}${route}`;
      try {
        const res = await axios.get(url, {
          timeout: Math.min(config.MIROFISH_REQUEST_TIMEOUT_MS, 10000),
          validateStatus: () => true
        });
        if (res.status >= 200 && res.status < 500) {
          return {
            ok: true,
            url: config.MIROFISH_URL,
            detectedRoute: route,
            statusCode: res.status,
            message: `Endpoint reachable: ${route}`
          };
        }
      } catch (err: any) {
        if (err?.response?.status) {
          return {
            ok: true,
            url: config.MIROFISH_URL,
            detectedRoute: route,
            statusCode: err.response.status,
            message: `Endpoint responded with status ${err.response.status} on ${route}`
          };
        }
      }
    }
    return {
      ok: false,
      url: config.MIROFISH_URL,
      message: "MiroFish unreachable. Start container/service and verify MIROFISH_URL."
    };
  }

  async predict(seed: SeedPacket, options: MiroFishPredictOptions): Promise<MiroFishPredictResponse> {
    try {
      const wf = {} as WorkflowContext;

      const project = await this.createProjectFromSeed(seed);
      wf.projectId = project.projectId;

      const build = await this.buildGraph(wf.projectId, seed.marketId);
      wf.graphTaskId = build.taskId;

      const graph = await this.waitGraphBuild(wf.graphTaskId, wf.projectId);
      wf.graphId = graph.graphId;

      const sim = await this.createSimulation(wf.projectId, wf.graphId);
      wf.simulationId = sim.simulationId;

      const prep = await this.prepareSimulation(wf.simulationId);
      wf.prepareTaskId = prep.taskId;
      const prepareReady = await this.waitPrepare(wf.prepareTaskId, wf.simulationId);
      if (!["ready", "completed"].includes(prepareReady.status)) {
        throw new WorkflowStepError({
          step: "prepareSimulation",
          simulationId: wf.simulationId,
          taskId: wf.prepareTaskId,
          status: prepareReady.status,
          rawPrepareStatus: prepareReady.raw
        }, `Prepare not ready: ${prepareReady.status}`);
      }

      const rounds = options.debugMode ? Math.min(options.rounds, config.MIROFISH_DEBUG_MAX_ROUNDS) : options.rounds;
      await this.startSimulation(wf.simulationId, { rounds });
      const simDone = await this.waitSimulation(wf.simulationId);
      wf.finalRunStatusRaw = simDone.raw;

      const reportTask = await this.generateReport(wf.simulationId);
      wf.reportTaskId = reportTask.taskId;
      wf.reportId = reportTask.reportId;
      wf.reportGenerateRaw = reportTask.raw;

      const reportDone = await this.waitReport(wf.reportTaskId, wf.simulationId, wf.reportId);
      wf.reportId = reportDone.reportId;
      wf.reportStatusRaw = reportDone.rawStatus;
      wf.reportBySimulationRaw = reportDone.rawBySimulation;

      const report = reportDone.report ?? (await this.fetchReportBySimulation(wf.simulationId));
      const parsed = this.parseProbabilityFromReport(report);
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.error,
          raw: { workflow: wf, report }
        };
      }
      return {
        ok: true,
        result: {
          marketId: seed.marketId,
          rawConfidenceScore: parsed.rawConfidenceScore,
          rawProbability: parsed.rawProbability,
          reportText: parsed.reportText,
          strongestYesArguments: [],
          strongestNoArguments: [],
          uncertainty: "workflow_report_parsed",
          modelMetadata: {
            workflow: wf,
            model: options.model ?? "deepseek-v3",
            agents: options.agents,
            rounds,
            parseSource: parsed.source
          }
        },
        raw: { workflow: wf, report }
      };
    } catch (err: any) {
      if (err instanceof WorkflowStepError) {
        return {
          ok: false,
          error: err.message,
          raw: err.detail
        };
      }
      const fallback =
        err?.code === "ECONNREFUSED"
          ? `Connection refused to ${config.MIROFISH_URL}`
          : err?.code
            ? `${err.code}: request failed`
            : "MiroFish workflow failed";
      return {
        ok: false,
        error: err?.message || fallback,
        raw: err?.response?.data ?? err
      };
    }
  }

  async createProjectFromSeed(seed: SeedPacket): Promise<{ projectId: string; raw: unknown }> {
    const markdown = this.seedToMarkdown(seed);
    const form = new FormData();
    const file = new Blob([markdown], { type: "text/markdown" });
    form.append("files", file, `polybot-${seed.marketId}.md`);
    form.append(
      "simulation_requirement",
      "Run a social prediction simulation with the named voter groups, candidates, media, unions, activists, polling agencies, and local business owners as agents. Estimate the probability that Alice Morgan wins. The final report must include numeric YES probability and confidence_score."
    );
    form.append("project_name", `polybot-${seed.marketId}-${Date.now()}`);

    const res = await this.post("/api/graph/ontology/generate", form, {
      headers: {}
    });
    const projectId = extractId(res.data, ["project_id", "projectId", "id", "data.project_id"]);
    if (!projectId) throw new Error("MiroFish createProjectFromSeed failed: project_id missing");
    return { projectId, raw: res.data };
  }

  async buildGraph(projectId: string, marketId: string): Promise<{ taskId: string; raw: unknown }> {
    const res = await this.post("/api/graph/build", {
      project_id: projectId,
      graph_name: `polybot-${marketId}`,
      chunk_size: 500,
      chunk_overlap: 50
    });
    const taskId = extractId(res.data, ["task_id", "taskId", "id", "data.task_id"]);
    if (!taskId) throw new Error("MiroFish buildGraph failed: task_id missing");
    return { taskId, raw: res.data };
  }

  async waitGraphBuild(taskId: string, projectId: string): Promise<{ graphId: string; raw: unknown }> {
    const deadline = Date.now() + config.MIROFISH_GRAPH_TIMEOUT_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      const res = await this.get(`/api/graph/task/${taskId}`);
      last = res.data;
      const status = normalizeStatus(res.data);
      if (status === "completed" || status === "ready") {
        const graphId =
          extractId(res.data, ["result.graph_id", "graph_id", "data.graph_id"]) ??
          (await this.fetchGraphIdFromProject(projectId));
        if (!graphId) throw new Error("Graph completed but graph_id missing");
        return { graphId, raw: res.data };
      }
      if (status === "failed" || status === "error") throw new Error(`Graph build failed: ${stringifyCompact(res.data)}`);
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`Graph build timeout. last=${stringifyCompact(last)}`);
  }

  async createSimulation(projectId: string, graphId: string): Promise<{ simulationId: string; raw: unknown }> {
    const res = await this.post("/api/simulation/create", {
      project_id: projectId,
      graph_id: graphId,
      enable_twitter: true,
      enable_reddit: true
    });
    const simulationId = extractId(res.data, ["simulation_id", "simulationId", "id", "data.simulation_id"]);
    if (!simulationId) throw new Error("createSimulation failed: simulation_id missing");
    return { simulationId, raw: res.data };
  }

  async prepareSimulation(simulationId: string): Promise<{ taskId: string; raw: unknown }> {
    const res = await this.post("/api/simulation/prepare", {
      simulation_id: simulationId,
      use_llm_for_profiles: true,
      parallel_profile_count: 1,
      force_regenerate: false
    });
    const taskId = extractId(res.data, ["task_id", "taskId", "id", "data.task_id"]);
    if (!taskId) throw new Error("prepareSimulation failed: task_id missing");
    return { taskId, raw: res.data };
  }

  async waitPrepare(taskId: string, simulationId: string): Promise<{ status: string; raw: unknown }> {
    const deadline = Date.now() + config.MIROFISH_PREPARE_TIMEOUT_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      const res = await this.post("/api/simulation/prepare/status", {
        task_id: taskId,
        simulation_id: simulationId
      });
      last = res.data;
      const status = normalizeStatus(res.data);
      const prepareFail = inspectPrepareFailure(res.data);
      if (prepareFail.shouldFail) {
        throw new WorkflowStepError(
          {
            step: "prepareSimulation",
            simulationId,
            taskId,
            status,
            entitiesCount: prepareFail.entitiesCount,
            entityTypes: prepareFail.entityTypes,
            error: prepareFail.error,
            rawPrepareStatus: res.data
          },
          `Prepare failed: ${prepareFail.error ?? "unknown prepare failure"}`
        );
      }
      if (status === "completed" || status === "ready") return { status, raw: res.data };
      if (status === "failed" || status === "error") throw new Error(`prepare failed: ${stringifyCompact(res.data)}`);
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`prepare timeout. last=${stringifyCompact(last)}`);
  }

  async startSimulation(simulationId: string, options: { rounds: number }): Promise<{ raw: unknown }> {
    const res = await this.post("/api/simulation/start", {
      simulation_id: simulationId,
      platform: "parallel",
      max_rounds: options.rounds,
      enable_graph_memory_update: false,
      force: false
    });
    return { raw: res.data };
  }

  async waitSimulation(simulationId: string): Promise<{ status: string; raw: unknown }> {
    const deadline = Date.now() + config.MIROFISH_SIMULATION_TIMEOUT_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      const res = await this.get(`/api/simulation/${simulationId}/run-status`);
      last = res.data;
      const payload: any = res.data ?? {};
      const data: any = payload.data ?? payload;
      const runnerStatus = String(data.runner_status ?? "").toLowerCase();
      const status = String(data.status ?? payload.status ?? "").toLowerCase();
      const progressPercent = Number(data.progress_percent ?? data.progress ?? 0);
      const twitterCompleted = data.twitter_completed === true;
      const redditCompleted = data.reddit_completed === true;
      const err = data.error ?? payload.error;

      if (err !== null && err !== undefined && String(err).trim() !== "") {
        throw new Error(`simulation failed: ${stringifyCompact(res.data)}`);
      }
      if (["failed", "error"].includes(runnerStatus) || ["failed", "error"].includes(status)) {
        throw new Error(`simulation failed: ${stringifyCompact(res.data)}`);
      }
      if (
        runnerStatus === "completed" ||
        status === "completed" ||
        progressPercent >= 100 ||
        (twitterCompleted && redditCompleted)
      ) {
        return { status: "completed", raw: res.data };
      }
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`simulation timeout. last=${stringifyCompact(last)}`);
  }

  async generateReport(simulationId: string): Promise<{ taskId: string; reportId: string; raw: unknown }> {
    const res = await this.post("/api/report/generate", {
      simulation_id: simulationId
    });
    const taskId = extractId(res.data, ["data.task_id", "task_id", "taskId", "id"]);
    const reportId = extractId(res.data, ["data.report_id", "report_id", "reportId", "id"]);
    if (!taskId) throw new Error("generateReport failed: task_id missing");
    return { taskId, reportId: reportId ?? "", raw: res.data };
  }

  async waitReport(taskId: string, simulationId: string, fallbackReportId?: string): Promise<{ reportId: string; rawStatus: unknown; rawBySimulation: unknown; report?: { reportText: string; raw: unknown } }> {
    const deadline = Date.now() + config.MIROFISH_REPORT_TIMEOUT_MS;
    let lastStatus: unknown;
    let lastBySimulation: unknown;
    let foundReportId = fallbackReportId ?? "";
    while (Date.now() < deadline) {
      let statusData: any;
      try {
        statusData = (await this.post("/api/report/generate/status", {
          task_id: taskId,
          simulation_id: simulationId
        })).data;
      } catch {
        statusData = (await this.get(`/api/report/generate/status?report_id=${encodeURIComponent(taskId)}`)).data;
      }
      lastStatus = statusData;
      foundReportId =
        extractId(statusData, ["data.report_id", "report_id", "reportId", "result.report_id", "id"]) ??
        foundReportId;
      const bySim = await this.fetchReportBySimulation(simulationId);
      lastBySimulation = bySim.raw;
      const hasMarkdown = Boolean(readPath(bySim.raw, "data.markdown_content") || readPath(bySim.raw, "markdown_content"));
      const hasSummary = Boolean(readPath(bySim.raw, "data.outline.summary") || readPath(bySim.raw, "outline.summary"));
      const status = normalizeStatus(statusData);
      if (hasMarkdown || hasSummary || status === "completed" || status === "ready") {
        return {
          reportId: foundReportId || "by-simulation",
          rawStatus: statusData,
          rawBySimulation: bySim.raw,
          report: bySim
        };
      }
      if (status === "failed" || status === "error") throw new Error(`report failed: ${stringifyCompact(statusData)}`);
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`report timeout. lastStatus=${stringifyCompact(lastStatus)} lastBySimulation=${stringifyCompact(lastBySimulation)}`);
  }

  async fetchReport(reportId: string): Promise<{ reportText: string; raw: unknown }> {
    const res = await this.get(`/api/report/${reportId}`);
    const reportText =
      readPath(res.data, "markdown_content") ??
      readPath(res.data, "content") ??
      readPath(res.data, "report") ??
      readPath(res.data, "data.markdown_content") ??
      readPath(res.data, "data.content") ??
      stringifyCompact(res.data);
    return { reportText: String(reportText ?? ""), raw: res.data };
  }

  async fetchReportBySimulation(simulationId: string): Promise<{ reportText: string; raw: unknown }> {
    const res = await this.get(`/api/report/by-simulation/${simulationId}`);
    const reportText =
      readPath(res.data, "data.markdown_content") ??
      readPath(res.data, "markdown_content") ??
      readPath(res.data, "data.outline.summary") ??
      readPath(res.data, "outline.summary") ??
      stringifyCompact(res.data);
    return { reportText: String(reportText ?? ""), raw: res.data };
  }

  parseProbabilityFromReport(report: { reportText: string; raw: unknown }): { ok: true; rawConfidenceScore: number; rawProbability: number; reportText: string; source: "markdown_content" | "outline.summary" } | { ok: false; error: string; reportText: string } {
    const markdown = String(readPath(report.raw, "data.markdown_content") ?? readPath(report.raw, "markdown_content") ?? "");
    const summary = String(readPath(report.raw, "data.outline.summary") ?? readPath(report.raw, "outline.summary") ?? "");
    const textSources: Array<{ source: "markdown_content" | "outline.summary"; text: string }> = [
      { source: "markdown_content", text: markdown || report.reportText || "" },
      { source: "outline.summary", text: summary }
    ];
    for (const src of textSources) {
      if (!src.text.trim()) continue;
      const parsed = parseProbabilityAndConfidence(src.text);
      if (parsed.probability !== undefined) {
        const rawProbability = clamp(parsed.probability, 0, 1);
        const rawConfidenceScore = clamp(parsed.confidence ?? rawProbability * 100, 0, 100);
        return {
          ok: true,
          rawConfidenceScore,
          rawProbability,
          reportText: src.text,
          source: src.source
        };
      }
    }
    return { ok: false, error: "Could not parse numeric probability from report", reportText: markdown || summary || report.reportText || "" };
  }

  private async fetchGraphIdFromProject(projectId: string): Promise<string | null> {
    try {
      const res = await this.get(`/api/graph/project/${projectId}`);
      return extractId(res.data, ["graph_id", "data.graph_id", "result.graph_id"]);
    } catch {
      return null;
    }
  }

  private seedToMarkdown(seed: SeedPacket): string {
    return [
      `# Prediction Market Seed: ${seed.marketId}`,
      "",
      `## question`,
      seed.question,
      "",
      `## bull_case`,
      seed.bull_case,
      "",
      `## bear_case`,
      seed.bear_case,
      "",
      `## current_odds`,
      String(seed.current_odds),
      "",
      `## best_bid`,
      String(seed.best_bid ?? ""),
      "",
      `## best_ask`,
      String(seed.best_ask ?? ""),
      "",
      `## spread`,
      String(seed.spread ?? ""),
      "",
      `## key_entities`,
      seed.key_entities.join(", "),
      "",
      `## resolution_date`,
      seed.resolution_date,
      "",
      `## resolution_rules`,
      seed.resolution_rules.join("\n"),
      "",
      `## evidence_summary`,
      seed.evidence_summary,
      "",
      `## uncertainty_factors`,
      seed.uncertainty_factors.join(", ")
    ].join("\n");
  }

  private async get(path: string) {
    return withRetry(
      async () =>
        axios.get(`${config.MIROFISH_URL}${path}`, {
          timeout: config.MIROFISH_REQUEST_TIMEOUT_MS
        }),
      2,
      800
    );
  }

  private async post(path: string, payload: unknown, extra?: { headers?: Record<string, string> }) {
    return withRetry(
      async () =>
        axios.post(`${config.MIROFISH_URL}${path}`, payload, {
          timeout: config.MIROFISH_REQUEST_TIMEOUT_MS,
          headers: extra?.headers
        }),
      2,
      800
    );
  }
}

function extractId(data: unknown, paths: string[]): string | null {
  for (const p of paths) {
    const v = readPath(data, p);
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
}

function readPath(obj: unknown, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  return path.split(".").reduce((acc: any, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj as any);
}

function normalizeStatus(data: any): string {
  const candidates = [
    readPath(data, "status"),
    readPath(data, "task_status"),
    readPath(data, "state"),
    readPath(data, "data.status"),
    readPath(data, "result.status"),
    readPath(data, "run_status")
  ]
    .map((x) => (typeof x === "string" ? x.toLowerCase() : ""))
    .filter(Boolean);
  return candidates[0] ?? "unknown";
}

function stringifyCompact(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseProbabilityAndConfidence(text: string): { probability?: number; confidence?: number } {
  const probPatterns = [
    /YES probability of\s*(0?\.\d+)/i,
    /YES probability\s*:\s*(0?\.\d+)/i,
    /YES probability\s*:\s*(\d+(?:\.\d+)?)\s*%/i,
    /YES probability of\s*(\d+(?:\.\d+)?)\s*%/i,
    /YES概率为\s*(0?\.\d+)/i
  ];
  const confPatterns = [
    /confidence score of\s*(0?\.\d+)/i,
    /confidence_score\s*:\s*(0?\.\d+)/i,
    /confidence score\s*:\s*(\d+(?:\.\d+)?)\s*%/i,
    /置信度得分为\s*(0?\.\d+)/i
  ];

  let probability: number | undefined;
  for (const p of probPatterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const n = Number(m[1]);
      probability = n > 1 ? n / 100 : n;
      break;
    }
  }
  let confidence: number | undefined;
  for (const p of confPatterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const n = Number(m[1]);
      confidence = n > 1 ? n : n * 100;
      break;
    }
  }
  return { probability, confidence };
}

function inspectPrepareFailure(data: unknown): {
  shouldFail: boolean;
  entitiesCount?: number;
  entityTypes?: string[];
  error?: string;
} {
  const status = normalizeStatus(data);
  const errorField = readPath(data, "error") ?? readPath(data, "data.error") ?? readPath(data, "result.error");
  const messageField = String(
    readPath(data, "message") ??
    readPath(data, "data.message") ??
    readPath(data, "result.message") ??
    ""
  ).toLowerCase();
  const entitiesCountRaw =
    readPath(data, "entities_count") ??
    readPath(data, "data.entities_count") ??
    readPath(data, "result.entities_count");
  const entitiesCount = Number.isFinite(Number(entitiesCountRaw)) ? Number(entitiesCountRaw) : undefined;
  const entityTypesRaw =
    readPath(data, "entity_types") ??
    readPath(data, "data.entity_types") ??
    readPath(data, "result.entity_types");
  const entityTypes = Array.isArray(entityTypesRaw) ? entityTypesRaw.map((x: unknown) => String(x)) : undefined;

  const noEntitiesMessage =
    messageField.includes("no matching entities") ||
    messageField.includes("no entities") ||
    messageField.includes("entities_count=0");

  const shouldFail =
    status === "failed" ||
    Boolean(errorField) ||
    noEntitiesMessage ||
    entitiesCount === 0;

  return {
    shouldFail,
    entitiesCount,
    entityTypes,
    error: errorField ? String(errorField) : noEntitiesMessage ? String(messageField || "no entities found") : undefined
  };
}

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

interface WorkflowContext {
  projectId: string;
  graphTaskId: string;
  graphId: string;
  simulationId: string;
  prepareTaskId: string;
  reportTaskId: string;
  reportId: string;
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
      await this.waitPrepare(wf.prepareTaskId, wf.simulationId);

      const rounds = options.debugMode ? Math.min(options.rounds, config.MIROFISH_DEBUG_MAX_ROUNDS) : options.rounds;
      await this.startSimulation(wf.simulationId, { rounds });
      await this.waitSimulation(wf.simulationId);

      const reportTask = await this.generateReport(wf.simulationId);
      wf.reportTaskId = reportTask.taskId;

      const reportDone = await this.waitReport(wf.reportTaskId, wf.simulationId);
      wf.reportId = reportDone.reportId;

      const report = await this.fetchReport(wf.reportId);
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
            rounds
          }
        },
        raw: { workflow: wf, report }
      };
    } catch (err: any) {
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
      "Run a prediction-market reasoning simulation. Estimate the probability that the market resolves YES. The final report must include a numeric YES probability from 0 to 100 and a confidence_score."
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
      const status = normalizeStatus(res.data);
      if (status === "completed" || status === "stopped" || status === "ready") return { status, raw: res.data };
      if (status === "failed" || status === "error") throw new Error(`simulation failed: ${stringifyCompact(res.data)}`);
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`simulation timeout. last=${stringifyCompact(last)}`);
  }

  async generateReport(simulationId: string): Promise<{ taskId: string; raw: unknown }> {
    const res = await this.post("/api/report/generate", {
      simulation_id: simulationId,
      force_regenerate: false
    });
    const taskId = extractId(res.data, ["task_id", "taskId", "id", "data.task_id"]);
    if (!taskId) throw new Error("generateReport failed: task_id missing");
    return { taskId, raw: res.data };
  }

  async waitReport(taskId: string, simulationId: string): Promise<{ reportId: string; raw: unknown }> {
    const deadline = Date.now() + config.MIROFISH_REPORT_TIMEOUT_MS;
    let last: unknown;
    while (Date.now() < deadline) {
      let data: any;
      try {
        data = (await this.post("/api/report/generate/status", {
          task_id: taskId,
          simulation_id: simulationId
        })).data;
      } catch {
        data = (await this.get(`/api/report/generate/status?report_id=${encodeURIComponent(taskId)}`)).data;
      }
      last = data;
      const status = normalizeStatus(data);
      if (status === "completed" || status === "ready") {
        const reportId = extractId(data, ["report_id", "reportId", "data.report_id", "result.report_id", "id"]);
        if (!reportId) throw new Error(`waitReport completed but report_id missing: ${stringifyCompact(data)}`);
        return { reportId, raw: data };
      }
      if (status === "failed" || status === "error") throw new Error(`report failed: ${stringifyCompact(data)}`);
      await sleep(config.MIROFISH_POLL_INTERVAL_MS);
    }
    throw new Error(`report timeout. last=${stringifyCompact(last)}`);
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

  parseProbabilityFromReport(report: { reportText: string; raw: unknown }): { ok: true; rawConfidenceScore: number; rawProbability: number; reportText: string } | { ok: false; error: string; reportText: string } {
    const text = report.reportText ?? "";
    const patterns = [
      /YES probability\s*:\s*(\d+(?:\.\d+)?)\s*%/i,
      /yes_probability\s*:\s*(\d+(?:\.\d+)?)/i,
      /probability\s*:\s*(\d+(?:\.\d+)?)\s*%/i,
      /probability\s*:\s*(0?\.\d+)/i,
      /resolves YES\s*:\s*(\d+(?:\.\d+)?)\s*%/i
    ];
    let probability: number | undefined;
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const n = Number(m[1]);
        probability = n > 1 ? n / 100 : n;
        break;
      }
    }

    const confPatterns = [
      /confidence_score\s*:\s*(\d+(?:\.\d+)?)\s*%?/i,
      /Confidence Score\s*:\s*(\d+(?:\.\d+)?)\s*%?/i
    ];
    let confidence: number | undefined;
    for (const p of confPatterns) {
      const m = text.match(p);
      if (m?.[1]) {
        const n = Number(m[1]);
        confidence = n > 1 ? n : n * 100;
        break;
      }
    }

    if (!Number.isFinite(probability)) {
      return { ok: false, error: "Could not parse numeric probability from report", reportText: text };
    }
    const rawProbability = clamp(probability!, 0, 1);
    const rawConfidenceScore = clamp(confidence ?? rawProbability * 100, 0, 100);
    return { ok: true, rawConfidenceScore, rawProbability, reportText: text };
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

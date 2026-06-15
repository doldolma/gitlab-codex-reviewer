import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Usage } from "@openai/codex-sdk";

const SHELL_TIMEOUT_MS = 60_000;
const SHELL_MAX_BUFFER = 4 * 1024 * 1024;
const TOOL_RESULT_MAX_CHARS = 6_000;
const DEFAULT_MAX_TOOL_ITERATIONS = 24;
const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const SAFETY_MARGIN_TOKENS = 1_024;
const KEEP_RECENT_GROUPS = 2;
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [500, 1_500, 4_500];
const WEB_TIMEOUT_MS = 15_000;
const WEB_FETCH_MAX_CHARS = 8_000;
const WEB_SEARCH_RESULTS = 5;
const WEB_UA = "Mozilla/5.0 (compatible; gitlab-codex-reviewer/1.0)";

// Prefer bash so the model's bashisms ([[ ]], process substitution, brace ranges)
// work; fall back to sh on minimal images that lack bash.
const SHELL_PATH = existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";

export type AgentRuntime = { baseUrl: string; apiKey: string | null; model: string; contextWindow: number };

export type ToolRunResult = {
  command: string;
  status: "completed" | "failed";
  exitCode: number | null;
  outputPreview: string;
};

export type RunAgentOptions = {
  runtime: AgentRuntime;
  /** Base system prompt; the agent appends workspace + verification guidance. */
  system: string;
  user: string;
  /** JSON schema enforced on the final answer via response_format. */
  outputSchema: unknown;
  schemaName: string;
  /** Repository root the run_shell tool runs in; null disables tools (diff-only). */
  workspace: string | null;
  enableThinking: boolean;
  maxToolIterations?: number;
  maxOutputTokens?: number;
  /** Enables the fetch_url + web_search tools (requires outbound network). */
  webTools?: boolean;
  /** Optional SearXNG-style JSON search endpoint; falls back to DuckDuckGo when unset. */
  searchUrl?: string | null;
  onToolEvent?: (result: ToolRunResult) => Promise<void> | void;
  signal?: AbortSignal;
};

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatResponse = {
  choices: { message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Drives a chat-completions model as a tool-using agent: explores the workspace
 * with run_shell, then forces a schema-validated final answer. Adds the context
 * management (#1) and transient-error retries (#2) the codex harness provided.
 */
export async function runOpenAICompatibleAgent(opts: RunAgentOptions): Promise<{ raw: string; usage: Usage }> {
  const { runtime, workspace, signal } = opts;
  const maxIterations = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const maxOutput = opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxInputTokens = Math.max(2_048, runtime.contextWindow - maxOutput - SAFETY_MARGIN_TOKENS);

  const webTools = opts.webTools ?? false;
  const searchEnabled = webTools && Boolean(opts.searchUrl);
  const tools: unknown[] = [];
  if (workspace) tools.push(SHELL_TOOL_DEF);
  if (webTools) tools.push(FETCH_URL_TOOL_DEF);
  if (searchEnabled) tools.push(WEB_SEARCH_TOOL_DEF);

  const systemContent = `${opts.system}${workspaceNote(workspace)}${webToolsNote(webTools, searchEnabled)}${verificationNote(workspace, webTools)}`;
  const userContent = capText(opts.user, maxInputTokens - estimateTokens(systemContent));
  let messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
  const usage = new UsageAccumulator();

  if (tools.length > 0) {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      messages = compact(messages, maxInputTokens);
      const response = await chat(runtime, messages, maxOutput, usage, signal, {
        tools,
        toolChoice: "auto",
        enableThinking: opts.enableThinking
      });
      const message = response.choices[0]?.message;
      if (!message) throw new Error("AI provider returned no message during exploration");
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) break;
      for (const call of toolCalls) {
        const result = await dispatchTool(call, { workspace, searchUrl: opts.searchUrl ?? null, signal });
        if (opts.onToolEvent) {
          await opts.onToolEvent({
            command: result.command,
            status: result.status,
            exitCode: result.exitCode,
            outputPreview: result.outputPreview
          });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result.resultForModel });
      }
    }
  }

  messages.push({ role: "user", content: FINALIZE_INSTRUCTION });
  const raw = await finalize(opts, runtime, messages, maxInputTokens, maxOutput, usage, signal);
  return { raw, usage: usage.toUsage() };
}

async function finalize(
  opts: RunAgentOptions,
  runtime: AgentRuntime,
  messages: ChatMessage[],
  maxInputTokens: number,
  maxOutput: number,
  usage: UsageAccumulator,
  signal: AbortSignal | undefined
): Promise<string> {
  let working = messages;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    working = compact(working, maxInputTokens);
    const response = await chat(runtime, working, maxOutput, usage, signal, {
      responseFormat: opts.outputSchema,
      schemaName: opts.schemaName,
      enableThinking: false
    });
    const raw = stripJsonFence(response.choices[0]?.message?.content ?? "");
    if (raw) {
      try {
        JSON.parse(raw);
        return raw;
      } catch {
        if (attempt === 1) return raw; // let the caller's parser throw with detail
        working = [
          ...working,
          { role: "assistant", content: raw },
          { role: "user", content: "That was not valid JSON. Output ONLY a single valid JSON object that matches the schema, with no prose or code fences." }
        ];
        continue;
      }
    }
    if (attempt === 1) throw new Error("AI response was empty");
    working = [...working, { role: "user", content: "Empty response. Output the final JSON object now." }];
  }
  throw new Error("AI response was empty");
}

async function chat(
  runtime: AgentRuntime,
  messages: ChatMessage[],
  maxOutput: number,
  usage: UsageAccumulator,
  signal: AbortSignal | undefined,
  opts: { tools?: unknown; toolChoice?: string; responseFormat?: unknown; schemaName?: string; enableThinking: boolean }
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: runtime.model,
    messages,
    max_tokens: maxOutput,
    chat_template_kwargs: { enable_thinking: opts.enableThinking }
  };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice ?? "auto";
  }
  if (opts.responseFormat) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.schemaName ?? "output", strict: true, schema: opts.responseFormat }
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (runtime.apiKey) headers.authorization = `Bearer ${runtime.apiKey}`;
  const url = `${runtime.baseUrl}/chat/completions`;
  const payload = JSON.stringify(body);

  for (let attempt = 0; ; attempt += 1) {
    const last = attempt >= RETRY_DELAYS_MS.length;
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers, body: payload, ...(signal ? { signal } : {}) });
    } catch (error) {
      if (signal?.aborted || last) throw error;
      await delay(RETRY_DELAYS_MS[attempt], signal);
      continue;
    }
    if (response.ok) {
      const data = (await response.json()) as ChatResponse;
      usage.add(data.usage?.prompt_tokens, data.usage?.completion_tokens);
      return data;
    }
    const text = (await safeText(response)).slice(0, 500);
    if (RETRY_STATUS.has(response.status) && !last) {
      await delay(RETRY_DELAYS_MS[attempt], signal);
      continue;
    }
    throw new Error(`OpenAI compatible request failed (${response.status}): ${text}`);
  }
}

// ---- context management (#1) -------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function messageTokens(message: ChatMessage): number {
  let total = 4;
  if (typeof message.content === "string") total += estimateTokens(message.content);
  if (message.role === "assistant" && message.tool_calls) total += estimateTokens(JSON.stringify(message.tool_calls));
  return total;
}

function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

function capText(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || estimateTokens(text) <= maxTokens) return text;
  const keep = Math.max(0, maxTokens * 4 - 64);
  return `${text.slice(0, keep)}\n…(input truncated to fit the model context window)`;
}

// Keeps the pinned system+user messages and the most recent exploration groups,
// dropping the oldest whole assistant→tool groups so tool_call references stay
// intact, until the transcript fits the input budget.
function compact(messages: ChatMessage[], maxInputTokens: number): ChatMessage[] {
  if (totalTokens(messages) <= maxInputTokens) return messages;
  const head = messages.slice(0, 2);
  const groups: ChatMessage[][] = [];
  for (const message of messages.slice(2)) {
    if (message.role === "assistant" || groups.length === 0) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }

  let kept = groups;
  while (kept.length > KEEP_RECENT_GROUPS && totalTokens([...head, ...kept.flat()]) > maxInputTokens) {
    kept = kept.slice(1);
  }
  const dropped = groups.length - kept.length;
  const notice: ChatMessage[] = dropped
    ? [{ role: "user", content: `(${dropped} earlier exploration step(s) omitted to stay within the context window.)` }]
    : [];
  return [...head, ...notice, ...kept.flat()];
}

// ---- run_shell tool ----------------------------------------------------------

const SHELL_TOOL_DEF = {
  type: "function",
  function: {
    name: "run_shell",
    description:
      "Run a shell command to inspect the code. The command ALREADY starts in the repository root (a disposable checkout in an isolated container), so use relative paths and never cd to absolute paths like /repo. Supports rg, git, cat, sed, ls, find, head, pipes, etc. There is no stdin, so always give search tools a path (e.g. 'rg pattern .', not 'rg pattern'). Prefer fast read-only inspection; avoid long-running, build, or network-heavy commands unless verifying a specific claim.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { command: { type: "string", description: "The command to run." } },
      required: ["command"]
    }
  }
};

const FETCH_URL_TOOL_DEF = {
  type: "function",
  function: {
    name: "fetch_url",
    description:
      "Fetch an http(s) URL and return its text (HTML stripped). Use to read official docs, release notes, or source — e.g. https://pkg.go.dev/errors to confirm an API exists.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { url: { type: "string", description: "Absolute http(s) URL." } },
      required: ["url"]
    }
  }
};

const WEB_SEARCH_TOOL_DEF = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web and return the top results (title, url, snippet). Use to find docs, release notes, or CVE details, then fetch_url the most relevant result.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "Search query." } },
      required: ["query"]
    }
  }
};

type ToolContext = { workspace: string | null; searchUrl: string | null; signal?: AbortSignal };

async function dispatchTool(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome> {
  switch (call.function.name) {
    case "run_shell":
      return ctx.workspace ? runShellTool(call, ctx.workspace, ctx.signal) : toolFailure("run_shell", "No workspace is available.");
    case "fetch_url":
      return runFetchUrl(call, ctx.signal);
    case "web_search":
      return runWebSearch(call, ctx.searchUrl, ctx.signal);
    default:
      return toolFailure(call.function.name, `Unknown tool '${call.function.name}'.`);
  }
}

const FINALIZE_INSTRUCTION =
  "Stop exploring. Now output ONLY the final answer as a single JSON object that matches the required schema. Do not include any prose, markdown, or code fences.";

type ToolOutcome = ToolRunResult & { resultForModel: string };

async function runShellTool(call: ToolCall, workspace: string, signal?: AbortSignal): Promise<ToolOutcome> {
  let command = "";
  try {
    const args = JSON.parse(call.function.arguments || "{}") as { command?: string };
    command = (args.command ?? "").trim();
  } catch {
    return toolFailure("", "Invalid tool arguments JSON.");
  }
  if (!command) return toolFailure("", "Empty command.");

  try {
    // The workspace is a disposable checkout inside an isolated container, so the
    // command runs as-is via the shell. Containment is the container's job; here we
    // only bound runtime and output size, and close stdin so search tools (rg/grep
    // with no path) read EOF instead of blocking on an open pipe.
    const { stdout, stderr, code, timedOut } = await runShell(command, {
      cwd: workspace,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: SHELL_MAX_BUFFER,
      signal
    });
    const combined = redact([stdout, stderr].filter(Boolean).join("\n").trim());
    const ok = code === 0 && !timedOut;
    const fallback = timedOut ? `(killed: exceeded ${SHELL_TIMEOUT_MS}ms)` : ok ? "(no output)" : `(exit ${code ?? "signal"})`;
    return {
      command,
      status: ok ? "completed" : "failed",
      exitCode: code,
      resultForModel: truncate(combined || fallback, TOOL_RESULT_MAX_CHARS),
      outputPreview: truncate(combined || fallback, 800)
    };
  } catch (error) {
    return toolFailure(command, error instanceof Error ? error.message : String(error));
  }
}

function toolFailure(command: string, reason: string): ToolOutcome {
  return { command, status: "failed", exitCode: null, resultForModel: `Error: ${reason}`, outputPreview: reason };
}

type ShellOutcome = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

function runShell(
  command: string,
  options: { cwd: string; timeout: number; maxBuffer: number; signal?: AbortSignal }
): Promise<ShellOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(SHELL_PATH, ["-c", command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {})
    });

    let stdout = "";
    let stderr = "";
    let size = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout);

    const capture = (buf: Buffer, append: (text: string) => void): void => {
      if (size >= options.maxBuffer) return;
      const remaining = options.maxBuffer - size;
      if (buf.length <= remaining) {
        append(buf.toString("utf8"));
        size += buf.length;
      } else {
        append(buf.subarray(0, remaining).toString("utf8"));
        size = options.maxBuffer;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (buf: Buffer) => capture(buf, (t) => (stdout += t)));
    child.stderr.on("data", (buf: Buffer) => capture(buf, (t) => (stderr += t)));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

// ---- web tools (fetch_url / web_search) -------------------------------------

async function runFetchUrl(call: ToolCall, signal?: AbortSignal): Promise<ToolOutcome> {
  let url = "";
  try {
    url = (JSON.parse(call.function.arguments || "{}").url ?? "").trim();
  } catch {
    return toolFailure("fetch_url", "Invalid tool arguments JSON.");
  }
  const label = `fetch_url ${url}`;
  const guard = guardUrl(url);
  if (guard) return toolFailure(label, guard);
  try {
    const response = await fetchWithTimeout(url, signal, { headers: { "user-agent": WEB_UA, accept: "text/html,application/json,text/plain,*/*" } });
    const body = (await response.text()).slice(0, WEB_FETCH_MAX_CHARS * 8);
    const contentType = response.headers.get("content-type") ?? "";
    const text = redact(contentType.includes("json") ? body : htmlToText(body));
    return {
      command: label,
      status: response.ok ? "completed" : "failed",
      exitCode: response.status,
      resultForModel: truncate(text || `(HTTP ${response.status}, no readable body)`, WEB_FETCH_MAX_CHARS),
      outputPreview: truncate(text, 800)
    };
  } catch (error) {
    return toolFailure(label, error instanceof Error ? error.message : String(error));
  }
}

async function runWebSearch(call: ToolCall, searchUrl: string | null, signal?: AbortSignal): Promise<ToolOutcome> {
  let query = "";
  try {
    query = (JSON.parse(call.function.arguments || "{}").query ?? "").trim();
  } catch {
    return toolFailure("web_search", "Invalid tool arguments JSON.");
  }
  if (!query) return toolFailure("web_search", "Empty query.");
  if (!searchUrl) return toolFailure("web_search", "No search backend configured; use fetch_url with a specific URL instead.");
  const label = `web_search ${query}`;
  try {
    const results = await searchViaJson(searchUrl, query, signal);
    const text = results.length
      ? results.map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join("\n")
      : "(no results — try fetch_url with a specific documentation URL instead)";
    return { command: label, status: "completed", exitCode: 0, resultForModel: truncate(redact(text), WEB_FETCH_MAX_CHARS), outputPreview: truncate(text, 800) };
  } catch (error) {
    return toolFailure(label, error instanceof Error ? error.message : String(error));
  }
}

type SearchHit = { title: string; url: string; snippet: string };

async function searchViaJson(searchUrl: string, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = new URL(searchUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetchWithTimeout(url.toString(), signal, { headers: { "user-agent": WEB_UA, accept: "application/json" } });
  const data = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? []).slice(0, WEB_SEARCH_RESULTS).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: stripTags(r.content ?? "")
  }));
}

function guardUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid or empty URL.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Only http(s) URLs are allowed.";
  if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
    return "Cloud metadata endpoints are blocked.";
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request to ${url} timed out`)), WEB_TIMEOUT_MS);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ---- prompt + helpers --------------------------------------------------------

export function splitPrompt(full: string): { system: string; user: string } {
  const sep = full.search(/\n\s*USER:\s*\n/);
  if (sep < 0) return { system: "You are a senior software engineer.", user: full };
  const system = full.slice(0, sep).replace(/^\s*SYSTEM:\s*\n?/, "").trim();
  const user = full.slice(sep).replace(/^\n\s*USER:\s*\n/, "").trim();
  return { system: system || "You are a senior software engineer.", user };
}

function workspaceNote(workspace: string | null): string {
  if (!workspace) return "";
  return [
    "\n\n<workspace>",
    `The run_shell tool already starts in the repository root: ${workspace}`,
    'Every command runs from there. Use relative paths (e.g. "cat go.mod", "head -20 client.go"). Do NOT cd into absolute paths like /repo — they do not exist.',
    'The tool has no stdin, so search tools must be given a path: write "rg pattern ." or "grep -rn pattern ." — never "rg pattern" with no path (it would read empty stdin and find nothing).',
    "</workspace>"
  ].join("\n");
}

function webToolsNote(webTools: boolean, searchEnabled: boolean): string {
  if (!webTools) return "";
  const lines = ["\n\n<web>"];
  lines.push(
    searchEnabled
      ? "You may use web_search(query) to find official documentation, release notes, or CVE details, and fetch_url(url) to read a page's text."
      : "You may use fetch_url(url) to read the text of a documentation or source page by its URL."
  );
  lines.push(
    "Use this to confirm uncertain facts about recent APIs, library behavior, or versions before reporting them — e.g. fetch_url('https://pkg.go.dev/errors') to check whether a function exists.",
    "Keep web use targeted and minimal; prefer the repository and toolchain first.",
    "</web>"
  );
  return lines.join("\n");
}

// Guards against knowledge-cutoff false positives: a local model's training data may
// predate the repo's toolchain, so it must verify "does not exist / won't compile"
// claims with the actual tooling instead of asserting them from memory.
function verificationNote(workspace: string | null, webTools: boolean): string {
  const lines = [
    "<verification>",
    "Your training data may be older than the language and toolchain versions this repository uses; recent releases add new standard-library and framework APIs you may not know.",
    "NEVER report that a symbol, function, or API 'does not exist', is 'undefined', or 'will not compile' based on memory alone."
  ];
  const verifiers: string[] = [];
  if (workspace) {
    verifiers.push(
      "the toolchain in this workspace — e.g. `go doc <pkg>.<Symbol>`, `go build ./...`, `go vet ./...` for Go; `npx tsc --noEmit` or the project linter for TS/JS (this overrides the 'do not run build commands' rule above, for read-only verification only)"
    );
  }
  if (webTools) verifiers.push("fetch_url (and web_search if available) against official documentation");
  if (verifiers.length) {
    lines.push(
      `Before reporting any such claim, verify it with ${verifiers.join(", or ")}.`,
      "If a verify command fails only because of missing network or dependencies, say so and lower the confidence — do not treat that as proof of a bug."
    );
  } else {
    lines.push(
      "You have no way to verify here, so describe any uncertain API or compile concern as a low-confidence note rather than a definitive issue."
    );
  }
  lines.push(
    "If you cannot verify an existence or compile claim, put it in notes with low confidence and mark it unverified — never as a high-confidence issue.",
    "</verification>"
  );
  return `\n\n${lines.join("\n")}`;
}

class UsageAccumulator {
  private input = 0;
  private output = 0;
  add(prompt?: number, completion?: number): void {
    this.input += prompt ?? 0;
    this.output += completion ?? 0;
  }
  toUsage(): Usage {
    return { input_tokens: this.input, cached_input_tokens: 0, output_tokens: this.output, reasoning_output_tokens: 0 } as Usage;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…(truncated)`;
}

function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function redact(value: string): string {
  return value
    .replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1<redacted>")
    .replace(/(PRIVATE-TOKEN[=:\s]+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

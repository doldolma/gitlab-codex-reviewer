import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { AppConfig } from "./config";

type JsonRpcResponse = { id: number; result?: unknown; error?: { code: number; message: string } };
type JsonRpcNotification = { method: string; params?: unknown };

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: AppConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.startInner();
    return this.initPromise;
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.start();
    const id = this.nextId++;
    const payload = params === undefined ? { method, id } : { method, id, params };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.child?.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  stop(): void {
    this.child?.kill();
    this.child = null;
    this.initPromise = null;
  }

  private async startInner(): Promise<void> {
    this.child = spawn(this.config.codexBin, ["app-server"], {
      env: {
        ...process.env,
        CODEX_HOME: this.config.codexHome
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.once("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.child = null;
      this.initPromise = null;
      this.emit("exit", error);
    });

    this.child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk.toString("utf8"));
    });

    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.handleLine(line));

    await this.rawRequest("initialize", {
      clientInfo: {
        name: "gitlab-codex-reviewer",
        title: "GitLab Codex Reviewer",
        version: "0.1.0"
      },
      capabilities: { experimentalApi: true }
    });
  }

  private rawRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.child) return Promise.reject(new Error("Codex app-server is not running"));
    const id = this.nextId++;
    const payload = params === undefined ? { method, id } : { method, id, params };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      this.emit("stderr", `Non-JSON Codex app-server output: ${line}`);
      return;
    }

    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    this.emit("notification", message);
    if (message.method) this.emit(message.method, message.params);
  }
}

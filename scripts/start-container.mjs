import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const shutdownTimeoutMs = 10_000;
const activeProcesses = new Map();
let shuttingDown = false;

process.on("SIGINT", () => {
  void shutdown("SIGINT", 0);
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM", 0);
});

try {
  await runBlocking("db", "npm", ["run", "db:deploy"]);

  const web = startProcess("web", process.execPath, [".next/standalone/server.js"]);
  const worker = startProcess("worker", process.execPath, ["dist/worker/index.js"]);
  const firstExit = await Promise.race([web.exited, worker.exited]);

  if (!shuttingDown) {
    const exitLabel =
      firstExit.signal ? `signal ${firstExit.signal}` : `code ${firstExit.code ?? 1}`;
    console.error(`[container] ${firstExit.name} exited with ${exitLabel}; stopping container`);
    await shutdown("process-exit", firstExit.code === 0 ? 1 : firstExit.code ?? 1);
  }
} catch (error) {
  if (!shuttingDown) {
    console.error(`[container] startup failed: ${formatError(error)}`);
    await shutdown("startup-failure", 1);
  }
}

async function runBlocking(name, command, args) {
  const child = startProcess(name, command, args);
  const result = await child.exited;
  if (result.error) {
    throw result.error;
  }
  if (result.code !== 0) {
    const exitLabel = result.signal ? `signal ${result.signal}` : `code ${result.code ?? 1}`;
    throw new Error(`${name} exited with ${exitLabel}`);
  }
}

function startProcess(name, command, args) {
  const child = spawn(resolveCommand(command), args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  pipeWithPrefix(name, child.stdout, process.stdout);
  pipeWithPrefix(name, child.stderr, process.stderr);

  const exited = new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(child.pid);
      resolve({ name, child, ...result });
    };

    child.once("error", (error) => {
      finish({ code: 1, signal: null, error });
    });

    child.once("exit", (code, signal) => {
      finish({ code, signal, error: null });
    });
  });

  if (child.pid) {
    activeProcesses.set(child.pid, { name, child, exited });
  }

  return { name, child, exited };
}

async function shutdown(reason, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (reason === "SIGINT" || reason === "SIGTERM") {
    console.log(`[container] received ${reason}; stopping services`);
  }

  const processes = [...activeProcesses.values()];
  for (const processInfo of processes) {
    if (isRunning(processInfo.child)) {
      processInfo.child.kill("SIGTERM");
    }
  }

  if (processes.length > 0) {
    await Promise.race([
      Promise.allSettled(processes.map((processInfo) => processInfo.exited)),
      delay(shutdownTimeoutMs).then(() => {
        for (const processInfo of processes) {
          if (isRunning(processInfo.child)) {
            console.error(`[container] ${processInfo.name} did not stop in time; sending SIGKILL`);
            processInfo.child.kill("SIGKILL");
          }
        }
      })
    ]);
  }

  process.exit(exitCode);
}

function pipeWithPrefix(name, stream, output) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    output.write(`[${name}] ${line}\n`);
  });
}

function resolveCommand(command) {
  if (process.platform === "win32" && command === "npm") return "npm.cmd";
  return command;
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

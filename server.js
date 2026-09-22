"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  TOOL_DEFINITIONS,
  createBrief,
  snapshot,
  restoreBrief,
  dispatchTool,
} = require("./tools");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const OUTPUTS_DIR = path.join(ROOT, "outputs");
const MAX_ROUNDS = 5;
const MAX_INPUT = 2000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const API_KEY = process.env.SILICONFLOW_API_KEY;
const BASE_URL = (process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1").replace(
  /\/$/,
  ""
);
const MODEL = process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-V4-Flash";
const PORT = Number(process.env.PORT || 8787);

if (!API_KEY) {
  console.error("缺少环境变量 SILICONFLOW_API_KEY。请复制 .env.example 为 .env 并填入密钥。");
  process.exit(1);
}

const SYSTEM_PROMPT = `你是需求简报 Agent。用户会给你一句模糊需求。你只能通过工具把需求收成四样东西：问题、范围、不做清单、人在哪一步确认。

规则：
1. 必须先调用 write_problem。
2. 再调用 write_bounds。
3. 最后调用 lock_brief。
4. 不要跳步。不要编造未提供的工具。
5. 不要把最终答案写在正文里；只通过工具写入。
6. 问题定义要可验证，不要写解决方案。
7. 范围写这一版具体做什么；不做清单写 3 到 5 条具体不做的事。
8. lock_brief 的 confirm_step 写清：谁、在哪一步、确认什么。

用户原文会在下一条消息里。`;

const rateBuckets = new Map();

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  if (bucket.count >= RATE_LIMIT) {
    return false;
  }
  bucket.count += 1;
  return true;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function parseArgs(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function callChat(messages) {
  const url = `${BASE_URL}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: "auto",
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`模型接口返回非 JSON（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    const msg =
      (data && data.error && (data.error.message || data.error)) ||
      text.slice(0, 300) ||
      `HTTP ${response.status}`;
    const err = new Error(String(msg));
    err.status = response.status;
    throw err;
  }

  return data;
}

async function handleDraft(text) {
  const userText = String(text || "").trim();
  if (!userText) {
    return { status: 400, body: { error: "请先贴一句模糊需求。" } };
  }
  if (userText.length > MAX_INPUT) {
    return {
      status: 400,
      body: { error: `需求过长，最多 ${MAX_INPUT} 字。` },
    };
  }

  const brief = createBrief(userText);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];
  const trace = [];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let data;
    try {
      data = await callChat(messages);
    } catch (err) {
      return {
        status: err.status && err.status >= 400 && err.status < 600 ? err.status : 502,
        body: { error: `模型调用失败：${err.message}` },
      };
    }

    const choice = data.choices && data.choices[0];
    const message = choice && choice.message;
    if (!message) {
      return { status: 502, body: { error: "模型未返回消息。" } };
    }

    const toolCalls = message.tool_calls;
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return {
        status: 502,
        body: {
          error: "模型没有调用工具。请换一个支持 function calling 的模型（改 SILICONFLOW_MODEL）。",
          draft: snapshot(brief),
          trace,
        },
      };
    }

    messages.push({
      role: "assistant",
      content: message.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function && call.function.name;
      const callId = call.id || `call_${trace.length}`;
      const args = parseArgs(call.function && call.function.arguments);

      if (args === null) {
        const errMsg = "工具参数不是合法 JSON，请重试并只输出合法参数。";
        trace.push({ tool: name, ok: false, error: errMsg });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: errMsg,
        });
        continue;
      }

      if (name === "lock_brief") {
        if (!brief.problem || !brief.scope || !brief.outOfScope) {
          const errMsg = "请先完成 write_problem 和 write_bounds，再调用 lock_brief。";
          trace.push({ tool: name, ok: false, error: errMsg });
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: errMsg,
          });
          continue;
        }

        const confirmStep =
          args.confirm_step != null ? String(args.confirm_step).replace(/\s+/g, " ").trim() : "";
        if (!confirmStep) {
          const errMsg = "confirm_step 不能为空。";
          trace.push({ tool: name, ok: false, error: errMsg });
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: errMsg,
          });
          continue;
        }

        brief.confirmStep = confirmStep;
        trace.push({ tool: name, ok: true, pending: true });

        return {
          status: 200,
          body: {
            status: "awaiting_confirm",
            draft: snapshot(brief),
            pending_lock: {
              name: "lock_brief",
              arguments: { confirm_step: confirmStep },
            },
            trace,
            user_text: userText,
          },
        };
      }

      const outcome = dispatchTool(name, brief, args, { allowLock: false });
      if (outcome.ok) {
        trace.push({ tool: name, ok: true, result: outcome.result });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: JSON.stringify(outcome.result),
        });
      } else {
        trace.push({ tool: name, ok: false, error: outcome.error });
        messages.push({
          role: "tool",
          tool_call_id: callId,
          content: outcome.error || "工具执行失败",
        });
      }
    }
  }

  return {
    status: 502,
    body: {
      error: "工具调用轮次用尽，未能完成简报。请换一句更具体的需求再试。",
      draft: snapshot(brief),
      trace,
    },
  };
}

function handleConfirm(body) {
  const userText = String(body.user_text || "").trim();
  const draft = body.draft;
  const pending = body.pending_lock;

  if (!userText) {
    return { status: 400, body: { error: "缺少原文，无法锁定。" } };
  }
  if (!draft || typeof draft !== "object") {
    return { status: 400, body: { error: "缺少草稿，无法锁定。" } };
  }
  if (!pending || pending.name !== "lock_brief") {
    return { status: 400, body: { error: "缺少待确认的 lock_brief。" } };
  }

  const args = pending.arguments || {};
  const brief = restoreBrief(userText, draft);
  const outcome = dispatchTool("lock_brief", brief, args, {
    allowLock: true,
    outputsDir: OUTPUTS_DIR,
  });

  if (!outcome.ok) {
    return { status: 400, body: { error: outcome.error || "锁定失败。" } };
  }

  return {
    status: 200,
    body: {
      status: "locked",
      filename: outcome.result.filename,
      draft: snapshot(brief),
    },
  };
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath.includes("..")) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (req.method === "POST" && urlPath === "/api/brief") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return;
    }

    const action = body.action;
    if (action === "draft") {
      const ip = clientIp(req);
      if (!checkRateLimit(ip)) {
        sendJson(res, 429, { error: "本小时请求过多，请稍后再试。" });
        return;
      }
      const result = await handleDraft(body.text);
      sendJson(res, result.status, result.body);
      return;
    }

    if (action === "confirm") {
      const result = handleConfirm(body);
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 400, { error: "未知 action。请使用 draft 或 confirm。" });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Brief Agent 已启动：http://0.0.0.0:${PORT}`);
});

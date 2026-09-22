"use strict";

const fs = require("fs");
const path = require("path");

const PROBLEM_MAX = 200;
const SCOPE_MAX = 400;
const CONFIRM_MAX = 200;
const OUT_MIN = 3;
const OUT_MAX = 5;

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function createBrief(userText) {
  return {
    userText: normalizeText(userText),
    problem: null,
    scope: null,
    outOfScope: null,
    confirmStep: null,
  };
}

function writeProblem(brief, args) {
  if (!brief) return { ok: false, error: "内部错误：缺少简报状态。" };

  const problem = normalizeText(args && args.problem);
  if (!problem) {
    return { ok: false, error: "problem 不能为空。" };
  }
  if (problem.length > PROBLEM_MAX) {
    return {
      ok: false,
      error: `problem 过长，最多 ${PROBLEM_MAX} 字，当前 ${problem.length} 字。`,
    };
  }
  if (problem === brief.userText) {
    return {
      ok: false,
      error: "problem 不能与用户原文一模一样，请收成一句可验证的问题定义。",
    };
  }

  brief.problem = problem;
  return {
    ok: true,
    result: { problem: brief.problem },
  };
}

function writeBounds(brief, args) {
  if (!brief) return { ok: false, error: "内部错误：缺少简报状态。" };
  if (!brief.problem) {
    return { ok: false, error: "请先调用 write_problem。" };
  }

  const scope = normalizeText(args && args.scope);
  if (!scope) {
    return { ok: false, error: "scope 不能为空。" };
  }
  if (scope.length > SCOPE_MAX) {
    return {
      ok: false,
      error: `scope 过长，最多 ${SCOPE_MAX} 字，当前 ${scope.length} 字。`,
    };
  }
  if (scope === brief.problem) {
    return {
      ok: false,
      error: "scope 不能把问题原句再贴一遍，请写这一版具体做什么。",
    };
  }

  let items = args && args.out_of_scope;
  if (typeof items === "string") {
    items = items
      .split(/\n|；|;/)
      .map((s) => normalizeText(s))
      .filter(Boolean);
  }
  if (!Array.isArray(items)) {
    return { ok: false, error: "out_of_scope 必须是字符串数组。" };
  }

  const cleaned = [];
  const seen = new Set();
  for (const raw of items) {
    const item = normalizeText(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(item);
  }

  if (cleaned.length < OUT_MIN || cleaned.length > OUT_MAX) {
    return {
      ok: false,
      error: `out_of_scope 需要 ${OUT_MIN} 到 ${OUT_MAX} 条不重复的具体不做事项，当前 ${cleaned.length} 条。`,
    };
  }

  brief.scope = scope;
  brief.outOfScope = cleaned;
  return {
    ok: true,
    result: {
      scope: brief.scope,
      out_of_scope: brief.outOfScope,
    },
  };
}

function lockBrief(brief, args, outputsDir) {
  if (!brief) return { ok: false, error: "内部错误：缺少简报状态。" };
  if (!brief.problem) {
    return { ok: false, error: "缺少问题定义，无法锁定。" };
  }
  if (!brief.scope || !Array.isArray(brief.outOfScope) || brief.outOfScope.length === 0) {
    return { ok: false, error: "缺少范围或不做清单，无法锁定。" };
  }

  const confirmStep = normalizeText(args && args.confirm_step);
  if (!confirmStep) {
    return { ok: false, error: "confirm_step 不能为空。" };
  }
  if (confirmStep.length > CONFIRM_MAX) {
    return {
      ok: false,
      error: `confirm_step 过长，最多 ${CONFIRM_MAX} 字，当前 ${confirmStep.length} 字。`,
    };
  }

  brief.confirmStep = confirmStep;

  const dir = outputsDir || path.join(__dirname, "outputs");
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const filename = `${stamp}.md`;
  const filepath = path.join(dir, filename);

  const markdown = [
    "# 需求简报",
    "",
    "## 问题",
    brief.problem,
    "",
    "## 范围",
    brief.scope,
    "",
    "## 不做清单",
    ...brief.outOfScope.map((item) => `- ${item}`),
    "",
    "## 人在哪一步确认",
    brief.confirmStep,
    "",
    "## 原文",
    brief.userText,
    "",
  ].join("\n");

  fs.writeFileSync(filepath, markdown, "utf8");

  return {
    ok: true,
    result: {
      filename,
      filepath,
      problem: brief.problem,
      scope: brief.scope,
      out_of_scope: brief.outOfScope,
      confirm_step: brief.confirmStep,
    },
  };
}

function snapshot(brief) {
  if (!brief) return null;
  return {
    problem: brief.problem,
    scope: brief.scope,
    out_of_scope: brief.outOfScope ? [...brief.outOfScope] : null,
    confirm_step: brief.confirmStep,
  };
}

function restoreBrief(userText, draft) {
  const brief = createBrief(userText);
  if (!draft || typeof draft !== "object") return brief;
  if (draft.problem) brief.problem = normalizeText(draft.problem);
  if (draft.scope) brief.scope = normalizeText(draft.scope);
  if (Array.isArray(draft.out_of_scope)) {
    brief.outOfScope = draft.out_of_scope.map((s) => normalizeText(s)).filter(Boolean);
  }
  if (draft.confirm_step) brief.confirmStep = normalizeText(draft.confirm_step);
  return brief;
}

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "write_problem",
      description:
        "把用户的模糊需求收成一句可验证的问题定义。只写问题，不写方案。必须先调用这个工具。",
      parameters: {
        type: "object",
        properties: {
          problem: {
            type: "string",
            description: "一句话问题定义：谁在什么场景要解决什么，不写解决方案。",
          },
        },
        required: ["problem"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_bounds",
      description:
        "在已有问题定义后，写下这一版的范围和 3 到 5 条具体不做的事。必须在 write_problem 之后调用。",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description: "这一版具体做什么，不要重复问题原句。",
          },
          out_of_scope: {
            type: "array",
            description: "3 到 5 条具体不做的事项。",
            items: { type: "string" },
            minItems: 3,
            maxItems: 5,
          },
        },
        required: ["scope", "out_of_scope"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lock_brief",
      description:
        "在问题和范围都写好后调用。提交人工确认点，准备锁定简报。这是不可逆步骤，调用后会暂停等人确认。",
      parameters: {
        type: "object",
        properties: {
          confirm_step: {
            type: "string",
            description:
              "一句话：谁、在哪一步、确认什么。例如「开工前由提出需求的人确认范围和不做清单」。",
          },
        },
        required: ["confirm_step"],
      },
    },
  },
];

function dispatchTool(name, brief, args, options = {}) {
  if (name === "write_problem") return writeProblem(brief, args);
  if (name === "write_bounds") return writeBounds(brief, args);
  if (name === "lock_brief") {
    if (!options.allowLock) {
      return {
        ok: false,
        error: "lock_brief 必须等人确认后才能执行。",
        pending: true,
      };
    }
    return lockBrief(brief, args, options.outputsDir);
  }
  return { ok: false, error: `未知工具：${name}` };
}

module.exports = {
  TOOL_DEFINITIONS,
  createBrief,
  snapshot,
  restoreBrief,
  dispatchTool,
  writeProblem,
  writeBounds,
  lockBrief,
};

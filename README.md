# Brief Agent

一页就能用的需求简报 Agent：贴一句模糊需求，收成问题、范围、不做清单、人在哪一步确认。写文件前停住，等人点确认。

免注册，免自填 API Key。密钥只放在服务器环境变量里。

## 配置密钥

```bash
cp .env.example .env
```

编辑 `.env`，填入：

- `SILICONFLOW_API_KEY`（必填）
- `SILICONFLOW_BASE_URL`（默认 `https://api.siliconflow.cn/v1`）
- `SILICONFLOW_MODEL`（默认 `deepseek-ai/DeepSeek-V4-Flash`；若不支持 tools，只改这个变量）
- `PORT`（默认 `8787`）

## 启动

```bash
node server.js
```

浏览器打开 `http://127.0.0.1:8787`。

## 部署到 Railway（给几个人试用）

1. 把本仓库推到 GitHub（不要提交 `.env`）。
2. 打开 [Railway Dashboard](https://railway.com/dashboard) → **New Project** → **Deploy from GitHub repo** → 选 `brief-agent`。
3. 在服务的 **Variables** 里添加：
   - `SILICONFLOW_API_KEY`（必填）
   - `SILICONFLOW_BASE_URL`=`https://api.siliconflow.cn/v1`（可选）
   - `SILICONFLOW_MODEL`=`deepseek-ai/DeepSeek-V4-Flash`（可选；不支持 tools 就换模型）
4. **Settings → Networking → Generate Domain**，用生成的 `*.up.railway.app` 链接发给朋友。
5. Start Command 用 `npm start`（Nixpacks 一般会自动识别）。

费用：新账号通常有 **Trial $5 / 30 天**；之后 Free 每月约 **$1 额度**。几个人偶尔点一下，一般到不了要付费。Hobby（$5/月）不是必须的。

注意：`outputs/` 写在容器磁盘上，重新部署后可能清空；演示够用。

## 怎样算跑通

1. 贴一句模糊需求，点「生成」，页面出现四块内容，trace 里有 `write_problem` 和 `write_bounds`。
2. 此时 `outputs/` 还没有新文件。
3. 点「确认锁定」后，出现一个新的 `.md`；页面显示已锁定和文件名。
4. 点「放弃」时不产生文件。
5. 刷新后再写一条，看不到上一条。
6. 浏览器网络面板里看不到 API Key，页面上也没有密钥输入框。

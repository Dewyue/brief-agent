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

## 部署到 Render（免费，电脑不用开着）

Railway 试用到期后可用这条。Render Free **不收托管费**；你的电脑可以关机。

代价：闲置约 15 分钟会休眠，别人第一次打开可能要等约 1 分钟醒来。几个人试用完全够用。

1. 打开 [https://dashboard.render.com](https://dashboard.render.com)，用 **GitHub** 登录。
2. **New +** → **Web Service** → 选仓库 `Dewyue/brief-agent`（私有库需先授权 Render）。
3. 填写：
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
4. **Environment** 里添加：
   - `SILICONFLOW_API_KEY`（必填，和本地 `.env` 同一个）
   - 可选：`SILICONFLOW_BASE_URL`=`https://api.siliconflow.cn/v1`
   - 可选：`SILICONFLOW_MODEL`=`deepseek-ai/DeepSeek-V4-Flash`
5. **Create Web Service**，等 Deploy 变绿。
6. 用生成的 `https://xxx.onrender.com` 链接发给朋友。

仓库里已有 `render.yaml`，也可在 Render 里用 **Blueprint** 一键导入。

注意：`outputs/` 在免费实例上不持久，重新部署或休眠醒来后文件可能没了；演示够用。硅基流动 API 费用另算。

## 部署到 Railway（试用额度用完后要付费）

Railway 新账号通常有 Trial；额度用完后创建项目常会要求升 Hobby（约 $5/月）。几个人试用优先用上面的 Render Free。

若仍用 Railway：连 GitHub 仓库 `brief-agent` → Variables 填 `SILICONFLOW_API_KEY` → Generate Domain。

## 怎样算跑通

1. 贴一句模糊需求，点「生成」，页面出现四块内容，trace 里有 `write_problem` 和 `write_bounds`。
2. 此时 `outputs/` 还没有新文件。
3. 点「确认锁定」后，出现一个新的 `.md`；页面显示已锁定和文件名。
4. 点「放弃」时不产生文件。
5. 刷新后再写一条，看不到上一条。
6. 浏览器网络面板里看不到 API Key，页面上也没有密钥输入框。

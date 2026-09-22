# Brief Agent

一页需求简报 Agent。贴一句模糊需求，收成四样东西：

- 问题
- 范围
- 不做清单
- 人在哪一步确认

写文件前会停住，等人点确认。免注册，密钥只放在服务器环境变量里。

## 本地运行

```bash
cp .env.example .env
```

在 `.env` 中填写 `SILICONFLOW_API_KEY`（必填）。可选：

- `SILICONFLOW_BASE_URL`（默认 `https://api.siliconflow.cn/v1`）
- `SILICONFLOW_MODEL`（默认 `deepseek-ai/DeepSeek-V4-Flash`）
- `PORT`（默认 `8787`）

```bash
npm start
```

打开 `http://127.0.0.1:8787`。

## 怎样算跑通

1. 贴一句模糊需求 → 生成，页面出现四块内容。
2. 确认锁定前，`outputs/` 没有新文件。
3. 确认锁定后，写出一个 `.md`，页面显示已锁定。
4. 放弃不落盘；刷新后看不到上一条。
5. 页面与网络请求里都不出现 API Key。

## 部署

需要一台能跑 Node、并配置环境变量的主机（如 Render / Railway / 任意 VPS）。

- 启动命令：`npm start`
- 必填环境变量：`SILICONFLOW_API_KEY`
- 仓库中的 `render.yaml` 可供 Render 使用（免费档可能要求绑定支付方式，以平台当前规则为准）

`outputs/` 写在运行实例本地磁盘上，重新部署后可能丢失。

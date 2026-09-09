# FitAI 生产部署

本文以 Docker Compose、Caddy 和域名 `app.fitai.website` 为例。命令中的域名、网络名和路径可以按自己的服务器调整。

## 1. 准备清单

- 一台安装了 Docker Engine 与 Docker Compose Plugin 的 Linux 服务器。
- 一个已解析到服务器公网 IP 的域名或子域名。
- 只开放发信权限的腾讯云 SES CAM 子用户。
- 已验证的 SES 发信域名、发信地址和邮件模板。
- 一个支持图片输入的 OpenAI 兼容 AI 接口。
- 至少开放防火墙端口 `22`、`80`、`443`；不要把容器的 `3000` 端口直接暴露公网。

## 2. 上传代码

推荐使用 Git：

```bash
sudo mkdir -p /opt/fitai
sudo chown "$USER":"$USER" /opt/fitai
git clone <YOUR_GITHUB_REPOSITORY_URL> /opt/fitai
cd /opt/fitai
```

私有仓库可以使用只读 Deploy Key 或权限受限的 GitHub Token。不要把个人长期 Token 写进脚本或仓库。

## 3. 环境变量

```bash
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，至少确认：

```dotenv
APP_ORIGIN=https://app.fitai.website
PORT=3000
DATA_DIR=/app/data
TRUST_PROXY=1
SESSION_SECRET=<至少 32 字节的随机字符串>
SESSION_DAYS=30
DAILY_ANALYSIS_LIMIT=10
LOGIN_CODE_EXPIRY_MINUTES=10

TENCENT_SES_REGION=ap-hongkong
TENCENT_SES_FROM=轻盈计划 <noreply@mail.fitai.website>
TENCENT_SES_TEMPLATE_ID=<模板 ID>
TENCENT_SES_SUBJECT=轻盈计划登录验证码
TENCENT_SES_SECRET_ID=<受限 CAM 子用户 SecretId>
TENCENT_SES_SECRET_KEY=<受限 CAM 子用户 SecretKey>

AI_API_URL=<OpenAI 兼容接口地址>
AI_MODEL=<支持图片输入的模型>
AI_API_KEY=<服务端 Token>
```

生成会话密钥示例：

```bash
openssl rand -hex 32
```

`APP_ORIGIN` 必须与浏览器实际使用的 HTTPS 来源完全一致，否则写接口会拒绝跨来源请求。

## 4. 代理网络与容器

默认 Compose 文件连接外部网络 `writing-assistant-proxy`。首次部署先创建：

```bash
docker network create writing-assistant-proxy
docker compose up -d --build
docker compose ps
```

如果服务器已有共享 Caddy 网络，在 `.env` 增加：

```dotenv
SHARED_PROXY_NETWORK=<现有网络名>
```

健康检查：

```bash
docker compose exec app node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>console.log(r.status,await r.text()))"
docker compose logs --tail=100 app
```

## 5. Caddy 与 HTTPS

将仓库中的 `Caddyfile` 片段加入共享 Caddy 配置，并确保 Caddy 容器也连接到同一个外部网络：

```caddyfile
app.fitai.website {
  encode zstd gzip
  reverse_proxy app:3000
}
```

如果 Compose 项目导致服务 DNS 名不同，可以使用实际容器服务名。重新加载 Caddy 后检查：

```bash
curl -I https://app.fitai.website/
curl https://app.fitai.website/api/health
```

期望健康接口返回 `{"ok":true}`，首页响应包含 HTTPS 和安全响应头。

## 6. 首次验收

1. 用真实邮箱请求验证码，确认邮件到达和 60 秒倒计时。
2. 登录后填写男女两种资料，确认消耗估算不同。
3. 从手机拍照和相册各上传一张，确认逐项食物可编辑。
4. 上传一张清晰营养成分表，核对单位、净含量和能量换算。
5. 保存餐食，重新打开详情，确认照片和完整文字可见。
6. 新增、编辑、取消删除和确认删除一条每日状态。
7. 退出账号后确认登录页从顶部显示，再登录确认记录仍存在。

## 7. 数据备份

Compose 使用命名卷 `fitai_data`。备份前先确认实际卷名：

```bash
docker volume ls | grep fitai
```

建议在短暂停止写入后，将整个 `/app/data` 目录作为一个整体备份，因为 SQLite 数据库与照片需要保持一致。示例：

```bash
mkdir -p /opt/backups/fitai
docker compose stop app
docker run --rm \
  -v <FITAI_VOLUME_NAME>:/data:ro \
  -v /opt/backups/fitai:/backup \
  alpine sh -c 'tar -czf /backup/fitai-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
docker compose start app
```

把备份复制到另一台设备或对象存储，并定期做恢复演练。删除旧备份前先确认新备份可读取。

## 8. 升级与回滚

升级前备份 `.env` 和数据卷，然后：

```bash
cd /opt/fitai
git fetch --tags
git checkout <NEW_VERSION_TAG>
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
```

出现问题时切回上一个已验证标签并重建：

```bash
git checkout <PREVIOUS_VERSION_TAG>
docker compose up -d --build app
```

代码回滚不会自动回滚数据。未来若加入数据库迁移，应在发布说明中明确兼容范围。

## 9. 上线后的维护

- 每周查看容器日志、磁盘空间、邮件发送失败和 AI 失败率。
- 每月安装系统安全更新并重建基础镜像。
- 定期运行 `npm audit --omit=dev` 和完整自动化测试。
- 定期轮换临时 SSH 公钥、部署 Token 和测试 Token。
- 用户规模增大前迁移到对象存储和可管理的数据库，并加入监控告警。

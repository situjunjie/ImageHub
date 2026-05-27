# Docker 部署说明

本文档说明如何使用 Docker 部署 Image Studio。

## 部署前提

- 已安装 Docker 和 Docker Compose。
- 服务器可以访问上游生图 API 地址。
- 默认服务端口为 `8877`。

## 项目部署结构

当前项目不是“纯静态前端 + 独立后端”的结构：

- React 前端由 Vite 提供页面服务。
- `/api/*` 后端接口写在 `vite.config.ts` 的 Vite middleware 中。
- 管理后台和广场数据写入容器内的 `.data/` 目录。

因此 Docker 容器需要运行 `npm run dev`，不能只用 Nginx 托管 `dist/`，否则 `/api/*` 接口会失效。

## 快速启动

在项目根目录执行：

```bash
docker compose up -d --build
```

如果服务器访问 Docker Hub 受限，可以临时指定 Node 基础镜像源：

```bash
NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine docker compose up -d --build
```

启动后访问：

```text
http://服务器IP:8877
http://服务器IP:8877/#admin
```

本机访问：

```text
http://localhost:8877
```

## 管理员账号

`docker-compose.yml` 中默认配置：

```yaml
ADMIN_USERNAME: admin
ADMIN_INITIAL_PASSWORD: "change-this-password"
```

首次部署前建议把 `ADMIN_INITIAL_PASSWORD` 修改为强密码。

注意：管理员初始账号只在第一次创建 `.data/admin-store.json` 时生效。如果数据卷已经存在，之后修改 `ADMIN_USERNAME` 或 `ADMIN_INITIAL_PASSWORD` 不会覆盖已有管理员账号。

## 数据持久化

Compose 文件使用命名卷保存运行时数据：

```yaml
volumes:
  - imagehub_data:/app/.data
```

`.data/` 中包含：

- `admin-store.json`：管理员、请求日志、审计日志。
- `square-store.json`：广场推荐、点赞、配额等数据。

不要删除 `imagehub_data` 数据卷，除非确认要清空管理后台和广场数据。

查看数据卷：

```bash
docker volume ls | grep imagehub
```

## 常用运维命令

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f imagehub
```

重启服务：

```bash
docker compose restart imagehub
```

停止服务：

```bash
docker compose down
```

停止并删除数据卷：

```bash
docker compose down -v
```

## 更新部署

拉取或同步最新代码后，在项目根目录执行：

```bash
docker compose up -d --build
```

如果只改了 `docker-compose.yml` 环境变量，也建议重建并重启：

```bash
docker compose up -d --build --force-recreate
```

## GitHub Actions 自动发布

项目提供 `.github/workflows/docker-publish.yml`，当 `master-situ` 分支发生 push 时，会自动构建并推送多架构 Docker 镜像：

- `linux/amd64`
- `linux/arm64`

推送到 Docker Hub 的镜像标签：

- `situjunjie976/image-hub:latest`
- `situjunjie976/image-hub:0.0.x`

版本号从 Git tag 自动递增。仓库没有 `v*.*.*` 标签时，首次发布为 `0.0.1`；之后按 patch 版本递增，例如 `0.0.2`、`0.0.3`。

在 GitHub 仓库中配置以下 Secrets：

```text
DOCKERHUB_USERNAME=situjunjie976
DOCKERHUB_TOKEN=你的 Docker Hub Access Token
```

建议使用 Docker Hub Access Token，不要直接使用 Docker Hub 登录密码。

如果需要改成其他分支触发，修改 `.github/workflows/docker-publish.yml` 中的：

```yaml
on:
  push:
    branches:
      - master-situ
```

## 公网反向代理

生产环境建议使用 Nginx、Caddy 或云厂商网关做 HTTPS 反向代理。

Nginx 示例：

```nginx
server {
  listen 80;
  server_name imagehub.example.com;

  client_max_body_size 80m;

  location / {
    proxy_pass http://127.0.0.1:8877;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

如果使用 HTTPS，请在反向代理层配置证书，并继续把流量转发到容器暴露的 `8877` 端口。

## 故障排查

如果页面可以打开但接口报错，先确认容器运行的是 `npm run dev`，而不是只托管 `dist/`。

检查 API 是否可达：

```bash
curl -i http://localhost:8877/api/admin/me
```

未登录时返回 `401` 属于正常结果，说明 `/api/admin/me` 已命中后端中间件。

如果容器启动失败，查看日志：

```bash
docker compose logs imagehub
```

如果重新部署后管理员密码没有变化，说明旧数据卷仍然存在。需要保留数据时请在管理后台修改密码；只有确认要清空数据时才执行：

```bash
docker compose down -v
docker compose up -d --build
```

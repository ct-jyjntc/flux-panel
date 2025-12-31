# 本地 Docker 部署（开发/自构建）

本说明用于在本机通过 Docker Compose **本地构建**并运行面板与后端。

## 1. 前置条件

- 已安装 Docker Desktop / Docker Engine
- 已安装 Docker Compose v2

## 2. 准备环境变量

在项目根目录创建 `.env`：

```bash
cat <<'EOF' > .env
DB_NAME=gost
DB_USER=gost
DB_PASSWORD=gost
JWT_SECRET=change-me
BACKEND_PORT=6365
FRONTEND_PORT=3000
EOF
```

按需修改端口或数据库账号密码即可。

## 3. 本地构建并启动

```bash
docker compose -f docker-compose-v4.yml up -d --build
```

启动后访问：
- 前端：`http://localhost:3000`
- 后端：`http://localhost:6365`

默认管理员账号：
- 账号：`admin_user`
- 密码：`admin_user`

首次登录后请及时修改密码。

## 4. 仅重建某个服务

仅重建前端：

```bash
docker compose -f docker-compose-v4.yml up -d --build frontend
```

仅重建后端：

```bash
docker compose -f docker-compose-v4.yml up -d --build backend
```

## 5. 常用维护命令

查看容器状态：

```bash
docker compose -f docker-compose-v4.yml ps
```

查看日志：

```bash
docker compose -f docker-compose-v4.yml logs -f backend
docker compose -f docker-compose-v4.yml logs -f frontend
```

停止服务：

```bash
docker compose -f docker-compose-v4.yml down
```

## 6. 数据库初始化说明

首次启动会自动执行 `gost.sql` 初始化数据库结构。
如果需要重置数据，请自行清理 `mysql_data` 卷后再启动：

```bash
docker compose -f docker-compose-v4.yml down
docker volume rm mysql_data
docker compose -f docker-compose-v4.yml up -d --build
```

## 7. 常见问题

- Apple Silicon（M 系列）建议使用 `docker-compose-v4.yml`（已使用 `mysql:8.0`）。
- 如果端口被占用，修改 `.env` 的 `BACKEND_PORT` / `FRONTEND_PORT` 后重启即可。

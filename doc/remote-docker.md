# 远端 Docker 部署（docker run / compose）

本说明用于在**目标服务器**上通过 Docker 运行已推送的镜像（不在服务器上编译）。

## 1. 前置条件

- 服务器已安装 Docker Engine（含 docker compose 插件）
- 服务器可访问 Docker Hub

## 2. 准备目录与数据库初始化脚本

```bash
mkdir -p /opt/flux-panel/mysql
mkdir -p /opt/flux-panel/backend-logs
# 把 gost.sql 放到 /opt/flux-panel/gost.sql
```

## 3. docker run 方式

### 3.1 创建网络

```bash
docker network create gost-network
```

### 3.2 启动 MySQL

```bash
docker run -d --name gost-mysql \
  --network gost-network \
  -e MYSQL_ROOT_PASSWORD=gost \
  -e MYSQL_DATABASE=gost \
  -e MYSQL_USER=gost \
  -e MYSQL_PASSWORD=gost \
  -e TZ=Asia/Shanghai \
  -v /opt/flux-panel/mysql:/var/lib/mysql \
  -v /opt/flux-panel/gost.sql:/docker-entrypoint-initdb.d/init.sql:ro \
  --restart unless-stopped \
  mysql:8.0 \
  --default-authentication-plugin=mysql_native_password \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --max_connections=1000 \
  --innodb_buffer_pool_size=256M
```

### 3.3 启动后端

```bash
docker run -d --name springboot-backend \
  --network gost-network \
  -e DB_HOST=gost-mysql \
  -e DB_NAME=gost \
  -e DB_USER=gost \
  -e DB_PASSWORD=gost \
  -e JWT_SECRET=change-me \
  -e LOG_DIR=/app/logs \
  -e JAVA_OPTS="-Xms256m -Xmx512m -Dfile.encoding=UTF-8 -Duser.timezone=Asia/Shanghai" \
  -v /opt/flux-panel/backend-logs:/app/logs \
  -p 6365:6365 \
  --restart unless-stopped \
  xiercloud/flux-panel-backend:local
```

### 3.4 启动前端

```bash
docker run -d --name vite-frontend \
  --network gost-network \
  -p 3000:80 \
  --restart unless-stopped \
  xiercloud/flux-panel-frontend:local
```

访问：
- 前端：`http://<服务器IP>:3000`
- 后端：`http://<服务器IP>:6365`

默认管理员账号：
- 账号：`admin_user`
- 密码：`admin_user`

## 4. docker compose 方式

在服务器上创建 `docker-compose.yml`：

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: gost-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: gost
      MYSQL_DATABASE: gost
      MYSQL_USER: gost
      MYSQL_PASSWORD: gost
      TZ: Asia/Shanghai
    volumes:
      - /opt/flux-panel/mysql:/var/lib/mysql
      - /opt/flux-panel/gost.sql:/docker-entrypoint-initdb.d/init.sql:ro
    command: >
      --default-authentication-plugin=mysql_native_password
      --character-set-server=utf8mb4
      --collation-server=utf8mb4_unicode_ci
      --max_connections=1000
      --innodb_buffer_pool_size=256M
    networks:
      - gost-network

  backend:
    image: xiercloud/flux-panel-backend:local
    container_name: springboot-backend
    restart: unless-stopped
    environment:
      DB_HOST: gost-mysql
      DB_NAME: gost
      DB_USER: gost
      DB_PASSWORD: gost
      JWT_SECRET: change-me
      LOG_DIR: /app/logs
      JAVA_OPTS: "-Xms256m -Xmx512m -Dfile.encoding=UTF-8 -Duser.timezone=Asia/Shanghai"
    ports:
      - "6365:6365"
    volumes:
      - /opt/flux-panel/backend-logs:/app/logs
    depends_on:
      - mysql
    networks:
      - gost-network

  frontend:
    image: xiercloud/flux-panel-frontend:local
    container_name: vite-frontend
    restart: unless-stopped
    ports:
      - "3000:80"
    depends_on:
      - backend
    networks:
      - gost-network

networks:
  gost-network:
    name: gost-network
```

启动：

```bash
docker compose up -d
```

## 5. 更新镜像

docker run 方式：

```bash
docker pull xiercloud/flux-panel-backend:local
docker pull xiercloud/flux-panel-frontend:local
docker restart springboot-backend
docker restart vite-frontend
```

docker compose 方式：

```bash
docker compose pull
docker compose up -d
```

## 6. 常见问题

- **前端无法访问**
  - 检查服务器安全组/防火墙放通 `3000`/`6365` 端口。
- **后端启动失败**
  - 先看 `docker logs springboot-backend`，确认数据库是否可用。
- **端口冲突**
  - 修改 `-p` 映射或 compose 里的端口再启动。

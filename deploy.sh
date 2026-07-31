#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  ImageHub / Image Studio 服务器部署脚本
#
#  用法：
#    ./deploy.sh              # 安装依赖 → 构建 → 重启服务（默认动作）
#    ./deploy.sh start        # 仅启动
#    ./deploy.sh stop         # 仅停止
#    ./deploy.sh restart      # 重启（不重新构建）
#    ./deploy.sh status       # 查看运行状态
#    ./deploy.sh systemd      # 生成并安装 systemd 服务（需 sudo）
#
#  端口：环境变量 PORT 控制，默认 8877
#  数据：全部在 ./.data/ 目录（SQLite、图片、配置），升级部署不受影响，建议定期备份
# ══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="imagehub"
PORT="${PORT:-8877}"
PID_FILE=".data/server.pid"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/server.log"
ACTION="${1:-deploy}"

info()  { echo -e "\033[32m[deploy]\033[0m $*"; }
warn()  { echo -e "\033[33m[deploy]\033[0m $*"; }
fail()  { echo -e "\033[31m[deploy]\033[0m $*" >&2; exit 1; }

check_node() {
  command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js >= 20（推荐 22 LTS）"
  local major
  major=$(node -p "process.versions.node.split('.')[0]")
  [ "$major" -ge 20 ] || fail "Node.js 版本过低（当前 $(node -v)），需要 >= 20"
  info "Node.js $(node -v) ✓"
}

ensure_env() {
  # 保留太极 AI 一键登录：OAuth 凭据通过 .env 注入（loadEnv 会自动读取项目根目录的 .env）
  if [ ! -f .env ]; then
    # 先建空文件并收紧权限，再写内容：避免凭据在 0644 状态下短暂可读。
    # umask 放在子 shell 里，免得影响脚本后续创建的日志等文件。
    ( umask 077; : > .env )
    cat > .env <<'EOF'
# ── ImageHub 环境配置 ──
# 太极 AI 一键登录（OAuth）。填入凭据后自动启用，留空则隐藏登录按钮。
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
OAUTH_PROVIDER_URL=https://www.taijiai.online
# 回调地址：不填则按访问域名自动推导（反代需转发 Host 与 X-Forwarded-Proto）。
# 也可显式指定，例如：https://imagehub.taijiai.online/api/auth/oauth/callback
OAUTH_REDIRECT_URI=

# 管理后台初始账号（仅首次创建 .data/admin-store.json 时生效）
# 初始密码请自行设置为强口令，首次登录后会强制修改。
# ADMIN_USERNAME=admin
# ADMIN_INITIAL_PASSWORD=
EOF
    warn "已生成 .env 模板 —— 请填入太极 OAuth 凭据后重新执行 ./deploy.sh restart"
  else
    info ".env 已存在，保留现有配置（含太极 OAuth）✓"
  fi
  # 无论新建还是沿用，都确保 .env 与 .data/ 只有属主可读：
  # 里面是 OAuth client_secret、实例密钥、以及全部用户生成的图片
  chmod 600 .env 2>/dev/null || true
  [ -d .data ] && chmod 700 .data 2>/dev/null || true
  [ -f .data/instance-secret ] && chmod 600 .data/instance-secret 2>/dev/null || true
}

install_deps() {
  info "安装依赖（better-sqlite3 为原生模块，首次会编译）..."
  if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi
}

build_all() {
  info "构建前端（含 TypeScript 检查）..."
  npm run build
  info "构建生产服务器..."
  npm run build:server
}

stop_server() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      info "停止旧进程 (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
  # 兜底：清掉占用端口的残留进程
  local holder
  holder=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)
  if [ -n "$holder" ]; then
    warn "端口 $PORT 被 pid $holder 占用，清理中..."
    kill "$holder" 2>/dev/null || true
    sleep 1
  fi
  info "服务已停止"
}

start_server() {
  [ -f server-dist/index.mjs ] || fail "缺少 server-dist/index.mjs，请先执行 ./deploy.sh（完整构建）"
  [ -f dist/index.html ] || fail "缺少 dist/index.html，请先执行 ./deploy.sh（完整构建）"
  mkdir -p "$LOG_DIR" .data
  info "启动服务（端口 $PORT）..."
  PORT="$PORT" nohup node server-dist/index.mjs >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1.5
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    info "✅ 服务已就绪：http://0.0.0.0:$PORT  （日志: $LOG_FILE）"
    info "   管理后台：http://<服务器IP>:$PORT/#admin"
  else
    fail "健康检查失败，请查看日志：tail -50 $LOG_FILE"
  fi
}

show_status() {
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    info "运行中 (pid $(cat "$PID_FILE"))"
    curl -s "http://127.0.0.1:$PORT/healthz" && echo
  else
    warn "未运行"
  fi
}

install_systemd() {
  [ "$(id -u)" -eq 0 ] || fail "安装 systemd 服务需要 root：sudo ./deploy.sh systemd"
  local workdir node_bin
  workdir=$(pwd)
  node_bin=$(command -v node)
  cat > "/etc/systemd/system/$APP_NAME.service" <<EOF
[Unit]
Description=ImageHub / Image Studio
After=network.target

[Service]
Type=simple
WorkingDirectory=$workdir
Environment=PORT=$PORT
ExecStart=$node_bin $workdir/server-dist/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$APP_NAME"
  info "systemd 服务已安装并启动：systemctl status $APP_NAME"
  warn "systemd 接管后请勿再用 ./deploy.sh start/stop 管理进程"
}

print_nginx_hint() {
  cat <<'EOF'

── 可选：Nginx 反向代理示例（HTTPS + 域名，OAuth 回调自动推导依赖这两个 header）──
server {
    listen 443 ssl;
    server_name imagehub.taijiai.online;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 64m;          # 参考图上传较大
    location / {
        proxy_pass http://127.0.0.1:8877;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;       # 大图生成耗时较长，避免网关提前掐断
        proxy_send_timeout 600s;
    }
}
EOF
}

case "$ACTION" in
  deploy)
    check_node
    ensure_env
    install_deps
    build_all
    stop_server
    start_server
    print_nginx_hint
    ;;
  start)   start_server ;;
  stop)    stop_server ;;
  restart) stop_server; start_server ;;
  status)  show_status ;;
  systemd) install_systemd ;;
  *) fail "未知动作：$ACTION（支持 deploy|start|stop|restart|status|systemd）" ;;
esac

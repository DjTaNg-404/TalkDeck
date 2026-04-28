#!/usr/bin/env bash
#
# TalkDeck · Whisper 本地环境一键 bootstrap 脚本（开发阶段使用）
#
# 作用：
#   1. 克隆并编译 whisper.cpp（在 macOS Apple Silicon 上启用 Metal 加速）
#   2. 把产物 whisper-cli 拷到 ~/Library/Application Support/TalkDeck/whisper/bin/
#   3. 下载默认模型 ggml-base.bin 到 .../whisper/models/
#
# 正式用户路径将在应用内设置页完成（Step 0.3），本脚本仅供开发者快速搭环境。
#
# 用法：
#   bash scripts/setup-whisper.sh            # 默认下载 base 模型 (142MB)
#   WHISPER_MODEL=small bash scripts/setup-whisper.sh    # 换模型
#   SKIP_BUILD=1 bash scripts/setup-whisper.sh           # 只下模型

set -euo pipefail

# 确保 Homebrew 路径在 PATH 中（兼容 bash 启动时不读 zprofile 的情况）
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# ---- 配置 ----
WHISPER_REPO="https://github.com/ggerganov/whisper.cpp.git"
WHISPER_TAG="v1.7.2"                 # 固定一个已知稳定版本
MODEL_NAME="${WHISPER_MODEL:-base}"  # 可用：tiny / base / small / medium / large-v3
SKIP_BUILD="${SKIP_BUILD:-0}"

# ---- 路径 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/vendor/whisper.cpp"

case "$(uname -s)" in
  Darwin)
    USER_DATA_DIR="$HOME/Library/Application Support/TalkDeck"
    ;;
  Linux)
    USER_DATA_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/TalkDeck"
    ;;
  *)
    echo "❌ 暂不支持的平台: $(uname -s)"
    exit 1
    ;;
esac

WHISPER_DIR="$USER_DATA_DIR/whisper"
BIN_DIR="$WHISPER_DIR/bin"
MODELS_DIR="$WHISPER_DIR/models"

# ---- 工具函数 ----
info()    { printf "\033[36m▸ %s\033[0m\n" "$*"; }
success() { printf "\033[32m✓ %s\033[0m\n" "$*"; }
warn()    { printf "\033[33m! %s\033[0m\n" "$*"; }
err()     { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }

# ---- 前置检查 ----
info "检查依赖..."
command -v git  >/dev/null 2>&1 || { err "未找到 git";  exit 1; }
command -v make >/dev/null 2>&1 || { err "未找到 make"; exit 1; }
command -v cc   >/dev/null 2>&1 || { err "未找到 C 编译器"; exit 1; }
command -v curl >/dev/null 2>&1 || { err "未找到 curl"; exit 1; }
success "依赖齐全"

mkdir -p "$BIN_DIR" "$MODELS_DIR"
info "资源目录: $WHISPER_DIR"

# ---- 1. 克隆/更新 whisper.cpp ----
if [ "$SKIP_BUILD" != "1" ]; then
  if [ ! -d "$VENDOR_DIR/.git" ]; then
    info "克隆 whisper.cpp 到 $VENDOR_DIR ..."
    git clone --depth 1 --branch "$WHISPER_TAG" "$WHISPER_REPO" "$VENDOR_DIR"
  else
    info "复用已有 whisper.cpp 仓库"
    if [ "${SKIP_FETCH:-0}" != "1" ]; then
      info "  更新 tag（如网络慢请 Ctrl+C 后用 SKIP_FETCH=1 bash ... 重跑）..."
      (cd "$VENDOR_DIR" && git fetch --tags --depth 1 origin "$WHISPER_TAG" >/dev/null 2>&1 || warn "  git fetch 失败，使用本地已有版本")
    else
      info "  跳过 git fetch（SKIP_FETCH=1）"
    fi
    (cd "$VENDOR_DIR" && git checkout "$WHISPER_TAG" >/dev/null 2>&1 || true)
  fi

  # ---- 2. 编译 ----
  info "编译 whisper.cpp（Metal 加速）..."
  cd "$VENDOR_DIR"
  make clean >/dev/null 2>&1 || true

  # 优先 cmake（v1.5+），若不可用则回退到旧版 Makefile
  if [ -f "CMakeLists.txt" ] && command -v cmake >/dev/null 2>&1; then
    cmake -B build -DGGML_METAL=1 -DCMAKE_BUILD_TYPE=Release >/dev/null
    cmake --build build --config Release -j
    # v1.7.2 及更早产物叫 main，更新版本叫 whisper-cli
    if [ -f "$VENDOR_DIR/build/bin/whisper-cli" ]; then
      BUILT_BIN="$VENDOR_DIR/build/bin/whisper-cli"
    else
      BUILT_BIN="$VENDOR_DIR/build/bin/main"
    fi
  else
    warn "cmake 未找到，使用 Makefile 编译..."
    WHISPER_METAL=1 make -j whisper-cli 2>/dev/null || WHISPER_METAL=1 make -j main
    if [ -f "$VENDOR_DIR/whisper-cli" ]; then
      BUILT_BIN="$VENDOR_DIR/whisper-cli"
    else
      BUILT_BIN="$VENDOR_DIR/main"
    fi
  fi

  if [ ! -f "$BUILT_BIN" ]; then
    err "编译产物未找到: $BUILT_BIN"
    exit 1
  fi

  info "拷贝二进制到 $BIN_DIR/whisper-cli"
  cp "$BUILT_BIN" "$BIN_DIR/whisper-cli"
  chmod +x "$BIN_DIR/whisper-cli"

  # 拷贝 Metal shader（Apple Silicon 需要）
  if [ -f "$VENDOR_DIR/ggml/src/ggml-metal/ggml-metal.metal" ]; then
    cp "$VENDOR_DIR/ggml/src/ggml-metal/ggml-metal.metal" "$BIN_DIR/"
  elif [ -f "$VENDOR_DIR/ggml-metal.metal" ]; then
    cp "$VENDOR_DIR/ggml-metal.metal" "$BIN_DIR/"
  fi

  success "whisper-cli 已就位"
  cd "$REPO_ROOT"
else
  warn "SKIP_BUILD=1，跳过编译步骤"
fi

# ---- 3. 下载模型 ----
MODEL_FILE="ggml-${MODEL_NAME}.bin"
MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

# 按镜像选择下载源。默认 hf（国际），国内网络可用 WHISPER_MIRROR=modelscope
case "${WHISPER_MIRROR:-hf}" in
  modelscope)
    MODEL_URL="https://www.modelscope.cn/models/cjc1887415157/whisper.cpp/resolve/master/${MODEL_FILE}"
    ;;
  hf-mirror)
    MODEL_URL="https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}"
    ;;
  *)
    MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}"
    ;;
esac

if [ -f "$MODEL_PATH" ]; then
  success "模型已存在: $MODEL_PATH"
else
  info "下载模型 $MODEL_FILE ..."
  info "来源: $MODEL_URL"
  if ! curl -L --fail --progress-bar --connect-timeout 15 -o "$MODEL_PATH.tmp" "$MODEL_URL"; then
    rm -f "$MODEL_PATH.tmp"
    err "下载失败。可尝试换镜像重跑："
    echo "  WHISPER_MIRROR=modelscope bash scripts/setup-whisper.sh"
    echo "  WHISPER_MIRROR=hf-mirror  bash scripts/setup-whisper.sh"
    exit 1
  fi
  mv "$MODEL_PATH.tmp" "$MODEL_PATH"
  success "模型已下载: $MODEL_PATH"
fi

# ---- 完成 ----
echo
success "Whisper 本地环境准备就绪"
echo
echo "  CLI:   $BIN_DIR/whisper-cli"
echo "  模型:  $MODEL_PATH"
echo
echo "下一步："
echo "  pnpm run dev    # 启动应用并使用录音功能"
echo

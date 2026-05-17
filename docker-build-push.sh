#!/usr/bin/env bash
#
# Multi-architecture Docker build and push script for mkcertWeb.
# Builds for linux/amd64 (Intel/AMD) and linux/arm64 (ARM64),
# tagged with the version read from package.json plus floating
# major / major.minor / latest tags.

set -euo pipefail

# Configuration
IMAGE_NAME="${IMAGE_NAME:-jeffcaldwellca/mkcertweb}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

err()  { echo -e "${RED}✖ $*${NC}" >&2; exit 1; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
info() { echo -e "${BLUE}$*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [--skip-clean-check] [--dry-run]

  --skip-clean-check  Allow pushing with uncommitted changes (NOT recommended)
  --dry-run           Build only; do not push to the registry
  -h, --help          Show this help

Environment:
  IMAGE_NAME          Override the image name (default: ${IMAGE_NAME})
EOF
  exit 0
}

# ---------- argument parsing ----------
SKIP_CLEAN_CHECK=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-clean-check) SKIP_CLEAN_CHECK=1 ;;
    --dry-run)          DRY_RUN=1 ;;
    -h|--help)          usage ;;
    *)                  err "Unknown argument: $arg" ;;
  esac
done

# ---------- preflight ----------

# Run from the repo root no matter where the user invoked us from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Tools we depend on
for tool in docker node git; do
  command -v "$tool" >/dev/null 2>&1 || err "Required tool '$tool' not found on PATH"
done
docker buildx version >/dev/null 2>&1 || err "docker buildx not available (need Docker 19.03+ with buildx)"

# Read version from package.json — single source of truth
VERSION="$(node -p "require('./package.json').version")" \
  || err "Failed to read version from package.json"
[[ -n "$VERSION" ]] || err "package.json version is empty"

# Parse major and major.minor for floating tags
MAJOR="${VERSION%%.*}"
MINOR_REST="${VERSION#*.}"
MINOR="${MINOR_REST%%.*}"
MAJOR_MINOR="${MAJOR}.${MINOR}"

info "Version from package.json: $VERSION"
info "Floating tags will be:     :latest, :${MAJOR}, :${MAJOR_MINOR}"

# Working tree must be clean (unless explicitly skipped)
if [[ "$SKIP_CLEAN_CHECK" -ne 1 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    err "Working tree has uncommitted changes. Commit them first, or rerun with --skip-clean-check."
  fi
  if [[ -n "$(git status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
    err "Working tree has untracked files. Commit/ignore them, or rerun with --skip-clean-check."
  fi
  ok "Working tree is clean"
else
  warn "Skipping working-tree clean check (--skip-clean-check)"
fi

# Verify we're logged in to Docker Hub (required for push). The classic check
# ('docker info | grep Username') only works with v1 credentials helpers; the
# more reliable modern check is to ask the credential store directly.
if [[ "$DRY_RUN" -ne 1 ]]; then
  info "Verifying Docker Hub login..."
  AUTH_OK=0
  # registry-1.docker.io is the canonical Hub registry hostname
  for host in "https://index.docker.io/v1/" "registry-1.docker.io" "docker.io"; do
    if docker-credential-desktop list 2>/dev/null | grep -q "$host" \
       || docker-credential-osxkeychain list 2>/dev/null | grep -q "$host" \
       || docker-credential-secretservice list 2>/dev/null | grep -q "$host" \
       || (docker info 2>/dev/null | grep -qE "(Username|^ ?Registry:[[:space:]]*$host)"); then
      AUTH_OK=1
      break
    fi
  done
  if [[ "$AUTH_OK" -ne 1 ]]; then
    err "Not logged in to Docker Hub. Run 'docker login' and try again."
  fi
  ok "Docker Hub credentials present"
fi

# ---------- buildx setup ----------
info "Setting up buildx builder..."
if ! docker buildx inspect multiarch >/dev/null 2>&1; then
  docker buildx create --name multiarch --use >/dev/null
else
  docker buildx use multiarch >/dev/null
fi
docker buildx inspect --bootstrap >/dev/null
ok "buildx ready"

# ---------- build (and push if not --dry-run) ----------
PLATFORMS="linux/amd64,linux/arm64"
TAGS=(
  "--tag" "${IMAGE_NAME}:${VERSION}"
  "--tag" "${IMAGE_NAME}:${MAJOR_MINOR}"
  "--tag" "${IMAGE_NAME}:${MAJOR}"
  "--tag" "${IMAGE_NAME}:latest"
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  info "Building (DRY RUN — no push) for $PLATFORMS"
  docker buildx build \
    --platform "$PLATFORMS" \
    "${TAGS[@]}" \
    .
  ok "Build complete (image NOT pushed)"
else
  info "Building and pushing for $PLATFORMS"
  docker buildx build \
    --platform "$PLATFORMS" \
    "${TAGS[@]}" \
    --push \
    .
  ok "Built and pushed:"
  echo "    ${IMAGE_NAME}:${VERSION}"
  echo "    ${IMAGE_NAME}:${MAJOR_MINOR}"
  echo "    ${IMAGE_NAME}:${MAJOR}"
  echo "    ${IMAGE_NAME}:latest"
fi

echo ""
info "Verify the manifest:"
echo "    docker buildx imagetools inspect ${IMAGE_NAME}:${VERSION}"
echo ""
info "Pull and run:"
echo "    docker pull ${IMAGE_NAME}:${VERSION}"
echo "    docker compose up -d"

#!/bin/bash

# Multi-architecture Docker build and push script for mkcertWeb
# Builds for linux/amd64 (Intel/AMD) and linux/arm64 (ARM64)

set -e

# Configuration
IMAGE_NAME="jeffcaldwellca/mkcertweb"
VERSION="3.1.3"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting multi-architecture build for ${IMAGE_NAME}:${VERSION}${NC}"

# Check if logged into Docker Hub
#echo -e "${BLUE}Checking Docker Hub login...${NC}"
#if ! docker info | grep -q "Username"; then
#    echo -e "${RED}Not logged into Docker Hub. Please run: docker login${NC}"
#    exit 1
#fi

# Create and use buildx builder if not exists
echo -e "${BLUE}Setting up buildx builder...${NC}"
if ! docker buildx ls | grep -q "multiarch"; then
    docker buildx create --name multiarch --use
else
    docker buildx use multiarch
fi

# Bootstrap the builder
docker buildx inspect --bootstrap

# Build and push multi-architecture image
echo -e "${BLUE}Building and pushing multi-arch images...${NC}"
echo -e "${BLUE}Platforms: linux/amd64, linux/arm64${NC}"

docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag ${IMAGE_NAME}:${VERSION} \
    --tag ${IMAGE_NAME}:latest \
    --push \
    .

echo -e "${GREEN}✓ Successfully built and pushed multi-architecture images!${NC}"
echo -e "${GREEN}✓ Available platforms: linux/amd64, linux/arm64${NC}"
echo -e "${GREEN}✓ Tags: ${IMAGE_NAME}:${VERSION}, ${IMAGE_NAME}:latest${NC}"
echo ""
echo -e "${BLUE}To verify the image manifest:${NC}"
echo "  docker buildx imagetools inspect ${IMAGE_NAME}:${VERSION}"
echo ""
echo -e "${BLUE}To pull and run:${NC}"
echo "  docker pull ${IMAGE_NAME}:${VERSION}"
echo "  docker-compose up -d"

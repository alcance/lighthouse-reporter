#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Lighthouse globally
npm install -g lighthouse


STORAGE_DIR=/opt/render/project/.render

if [[ ! -d $STORAGE_DIR/chrome ]]; then
  echo "...Downloading Chrome"
  mkdir -p $STORAGE_DIR/chrome
  cd $STORAGE_DIR/chrome
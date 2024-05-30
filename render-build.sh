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
  wget -P ./ https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  dpkg -x ./google-chrome-stable_current_amd64.deb $STORAGE_DIR/chrome
  rm ./google-chrome-stable_current_amd64.deb
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/google-chrome
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/chrome
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/chrome-sandbox
  export PATH="${PATH}:/opt/render/project/.render/chrome/opt/google/chrome"
  cd $HOME/project/src # Make sure we return to where we were
else
  echo "...Using Chrome from cache"
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/google-chrome
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/chrome
  chmod +x $STORAGE_DIR/chrome/opt/google/chrome/chrome-sandbox
fi

# Debug: List contents of the Chrome directory
ls -la $STORAGE_DIR/chrome/opt/google/chrome

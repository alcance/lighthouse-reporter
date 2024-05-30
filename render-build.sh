#!/usr/bin/env bash

# Update package list and install dependencies
apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates

# Install Chromium
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update && apt-get install -y google-chrome-stable

# Clean up
apt-get clean
rm -rf /var/lib/apt/lists/*

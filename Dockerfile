# 1) Base image with Node 22
FROM node:22

# 2) Install Chrome dependencies & Chrome Stable
# We use the modern 'signed-by' method to avoid apt-key deprecation errors
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | \
       gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
       > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3) Create app dir & install deps
WORKDIR /app
COPY package*.json ./
# Use --omit=dev to keep the image smaller if you don't need dev tools
RUN npm install --omit=dev

# 4) Copy your code
COPY . .

# 5) Expose the CORRECT port (Matches your server.js)
EXPOSE 3500

CMD ["node", "server.js"]

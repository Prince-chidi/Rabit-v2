# Deployment Guide for RabitServer

## Prerequisites
- VPS with Ubuntu 22.04 LTS (recommended)
- Domain name (optional but recommended for HTTPS)
- SSH access to your VPS

---

## Step 1: Initial VPS Setup

### 1.1 Connect to your VPS via SSH
```bash
ssh root@YOUR_VPS_IP
```

### 1.2 Update system
```bash
apt update && apt upgrade -y
```

### 1.3 Install Docker & Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install docker-compose -y

# Start Docker
systemctl start docker
systemctl enable docker
```

---

## Step 2: Upload Your Application

### Option A: Using Git (Recommended)
```bash
# Install Git
apt install git -y

# Clone your repository
cd /opt
git clone https://github.com/YOUR_USERNAME/rabitServer.git
cd rabitServer
```

### Option B: Using SCP (from your local machine)
```powershell
# From your Windows machine
scp -r "d:\DISK C\rabitServer" root@YOUR_VPS_IP:/opt/rabitServer
```

---

## Step 3: Build and Run with Docker

```bash
cd /opt/rabitServer

# Build the Docker image
docker build -t rabit-scraper .

# Run the container
docker run -d \
  --name rabit-scraper \
  --restart unless-stopped \
  -p 80:3500 \
  rabit-scraper

# Check if running
docker ps
```

**Your API is now accessible at:** `http://YOUR_VPS_IP/health`

---

## Step 4: Setup Firewall

```bash
# Install UFW (Uncomplicated Firewall)
apt install ufw -y

# Allow SSH (important - don't lock yourself out!)
ufw allow 22/tcp

# Allow HTTP
ufw allow 80/tcp

# Allow HTTPS (for later)
ufw allow 443/tcp

# Enable firewall
ufw enable
```

---

## Step 5: Add HTTPS with Domain (Recommended)

### 5.1 Point your domain to VPS
- Go to your domain registrar (Namecheap, GoDaddy, etc.)
- Add an A record: `api.yourdomain.com` → `YOUR_VPS_IP`

### 5.2 Install Nginx as reverse proxy
```bash
apt install nginx certbot python3-certbot-nginx -y
```

### 5.3 Create Nginx configuration
```bash
nano /etc/nginx/sites-available/rabit-scraper
```

**Add this content:**
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    # Increase timeouts for long-running scraping requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://localhost:3500;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

### 5.4 Enable the site
```bash
ln -s /etc/nginx/sites-available/rabit-scraper /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 5.5 Get SSL certificate (HTTPS)
```bash
certbot --nginx -d api.yourdomain.com
```

**Your API is now accessible at:** `https://api.yourdomain.com/health`

---

## Step 6: Environment Variables (Optional)

Create a `.env` file for configuration:

```bash
nano /opt/rabitServer/.env
```

```env
PORT=3500
NODE_ENV=production
```

Update Docker run command:
```bash
docker run -d \
  --name rabit-scraper \
  --restart unless-stopped \
  --env-file .env \
  -p 80:3500 \
  rabit-scraper
```

---

## Step 7: Monitor & Manage

### Check logs
```bash
docker logs -f rabit-scraper
```

### Restart container
```bash
docker restart rabit-scraper
```

### Stop container
```bash
docker stop rabit-scraper
```

### Update application
```bash
cd /opt/rabitServer
git pull  # if using git
docker build -t rabit-scraper .
docker stop rabit-scraper
docker rm rabit-scraper
docker run -d --name rabit-scraper --restart unless-stopped -p 80:3500 rabit-scraper
```

---

## Step 8: Client Integration

Your client can now access the API:

### Without domain (HTTP only)
```javascript
const response = await fetch('http://YOUR_VPS_IP/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    country: 'Germany',
    degree: 'msc',
    fields: ['programName', 'university', 'tuitionFee'],
    range: [1, 5]
  })
});
```

### With domain (HTTPS - Recommended)
```javascript
const response = await fetch('https://api.yourdomain.com/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    country: 'Germany',
    degree: 'msc',
    fields: ['programName', 'university', 'tuitionFee'],
    range: [1, 5]
  })
});
```

---

## Security Recommendations

### 1. Add API Key Authentication
Modify your `server.js` to require an API key:

```javascript
const API_KEY = process.env.API_KEY || 'your-secret-key';

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

### 2. Rate Limiting
Install and use express-rate-limit to prevent abuse.

### 3. Change SSH Port
```bash
nano /etc/ssh/sshd_config
# Change Port 22 to Port 2222
systemctl restart sshd
ufw allow 2222/tcp
ufw delete allow 22/tcp
```

### 4. Setup Monitoring
Use tools like:
- **Uptime Kuma** (self-hosted monitoring)
- **UptimeRobot** (free external monitoring)
- **Grafana + Prometheus** (advanced metrics)

---

## Troubleshooting

### Container won't start
```bash
docker logs rabit-scraper
```

### Port already in use
```bash
# Find what's using port 80
netstat -tlnp | grep :80
# Kill the process or use a different port
```

### Out of memory
```bash
# Check memory usage
free -h
docker stats

# Add swap space
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Can't access from internet
```bash
# Check firewall
ufw status

# Check if Docker is listening
netstat -tlnp | grep docker

# Check Nginx (if using)
systemctl status nginx
nginx -t
```

---

## Quick Commands Reference

```bash
# View running containers
docker ps

# View all containers
docker ps -a

# Container logs
docker logs -f rabit-scraper

# Restart container
docker restart rabit-scraper

# Remove container
docker stop rabit-scraper && docker rm rabit-scraper

# Check disk space
df -h

# Check memory
free -h

# Check CPU
top
```

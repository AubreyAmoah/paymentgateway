# Payment Gateway - EC2 Deployment Guide

Complete guide for deploying the Payment Gateway on AWS EC2 using Docker and Nginx.

## Prerequisites

- AWS EC2 instance (Ubuntu 20.04 or newer recommended)
- SSH access to your EC2 instance
- Domain name (optional, for SSL)
- Security group configured to allow ports 80 and 443

## Step 1: Launch EC2 Instance

1. Log in to AWS Console
2. Launch a new EC2 instance:
   - **AMI**: Ubuntu Server 20.04 LTS or 22.04 LTS
   - **Instance Type**: t2.micro (free tier) or t3.small (recommended)
   - **Storage**: 20GB minimum
   - **Security Group**: Create with the following rules:
     - SSH (22) - Your IP
     - HTTP (80) - 0.0.0.0/0
     - HTTPS (443) - 0.0.0.0/0

3. Download your `.pem` key file

## Step 2: Connect to EC2

```bash
# Set permissions on your key
chmod 400 your-key.pem

# Connect to EC2
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

## Step 3: Install Docker and Docker Compose

```bash
# Update package list
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version

# Log out and back in for group changes to take effect
exit
```

## Step 4: Transfer Files to EC2

From your local machine:

```bash
# Create deployment package
cd /home/kwame/mainstreamhouse/paymentgateway
tar -czf paymentgateway.tar.gz \
  --exclude=node_modules \
  --exclude=data \
  --exclude=logs \
  --exclude=*.db \
  --exclude=.git \
  .

# Transfer to EC2
scp -i your-key.pem paymentgateway.tar.gz ubuntu@your-ec2-public-ip:~/
```

## Step 5: Setup Application on EC2

```bash
# SSH back into EC2
ssh -i your-key.pem ubuntu@your-ec2-public-ip

# Create application directory
mkdir -p ~/paymentgateway
cd ~/paymentgateway

# Extract files
tar -xzf ~/paymentgateway.tar.gz

# Create necessary directories
mkdir -p data logs logs/nginx ssl

# Create .env file (IMPORTANT: Update with your credentials)
nano .env
```

Paste your .env configuration:
```env
# Payment Gateway Configuration

# API Credentials
USERNAME=dcmtest
PASSWORD=Dcm@2024

# Partner Configuration
PARTNER_CODE=MSH

# Mobile Network Bank Codes
MTN_BANK_CODE=300591
AIRTELTIGO_BANK_CODE=300592
TELECEL_BANK_CODE=300594

# API Base URLs
AUTH_API_URL=https://dcmapitest.dcm-gh.com/User/Login
COLLECTION_API_URL=https://dcmapitest.dcm-gh.com/Transaction/Collection
NAME_ENQUIRY_API_URL=https://dcmapisandbox.dcm-gh.com/Transaction/NameEnquiry

# Server Configuration
PORT=3000

# Database Configuration - SQLite
DATABASE_URL="file:/app/data/dev.db"
```

Save and exit (Ctrl+X, Y, Enter)

## Step 6: Build and Start Containers

```bash
# Build and start containers
docker-compose up -d

# Check container status
docker-compose ps

# View logs
docker-compose logs -f

# Check specific service logs
docker-compose logs -f payment-gateway
docker-compose logs -f nginx
```

## Step 7: Initialize Database

```bash
# Access the container
docker-compose exec payment-gateway sh

# Push database schema
npx prisma db push

# Exit container
exit
```

## Step 8: Test the Deployment

```bash
# Test health endpoint
curl http://localhost/health

# Test from your local machine
curl http://your-ec2-public-ip/health
```

## Step 9: Configure SSL (Optional but Recommended)

### Option A: Using Let's Encrypt (Free SSL)

```bash
# Install certbot
sudo apt install certbot

# Stop nginx temporarily
docker-compose stop nginx

# Generate SSL certificate
sudo certbot certonly --standalone -d your-domain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ~/paymentgateway/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem ~/paymentgateway/ssl/
sudo chown $USER:$USER ~/paymentgateway/ssl/*
```

Update `nginx.conf` to add SSL:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ... rest of your nginx config
}
```

Restart nginx:
```bash
docker-compose restart nginx
```

## Useful Commands

### Container Management
```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart services
docker-compose restart

# View logs
docker-compose logs -f

# Rebuild and restart
docker-compose up -d --build
```

### Database Management
```bash
# Access database
docker-compose exec payment-gateway npx prisma studio

# Backup database
docker-compose exec payment-gateway cp /app/data/dev.db /app/data/backup-$(date +%Y%m%d).db

# View database
docker-compose exec payment-gateway sqlite3 /app/data/dev.db "SELECT * FROM payments;"
```

### Monitoring
```bash
# View container stats
docker stats

# Check container health
docker-compose ps

# View nginx access logs
tail -f logs/nginx/access.log

# View application logs
docker-compose logs -f payment-gateway
```

## Security Best Practices

1. **Firewall Configuration**
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

2. **Regular Updates**
   ```bash
   # Update system packages
   sudo apt update && sudo apt upgrade -y

   # Update Docker images
   docker-compose pull
   docker-compose up -d
   ```

3. **Backup Strategy**
   ```bash
   # Create backup script
   nano ~/backup.sh
   ```

   Add:
   ```bash
   #!/bin/bash
   BACKUP_DIR=~/backups
   mkdir -p $BACKUP_DIR
   DATE=$(date +%Y%m%d_%H%M%S)

   # Backup database
   docker-compose exec -T payment-gateway cp /app/data/dev.db /app/data/backup-$DATE.db

   # Copy to backup directory
   cp ~/paymentgateway/data/backup-$DATE.db $BACKUP_DIR/

   # Remove old backups (keep last 7 days)
   find $BACKUP_DIR -name "backup-*.db" -mtime +7 -delete
   ```

   Make executable and schedule:
   ```bash
   chmod +x ~/backup.sh
   crontab -e
   # Add: 0 2 * * * ~/backup.sh
   ```

4. **Environment Variables**
   - Never commit `.env` to git
   - Use strong passwords
   - Rotate credentials regularly

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose logs payment-gateway

# Check if port is in use
sudo netstat -tulpn | grep 3000

# Restart containers
docker-compose restart
```

### Database issues
```bash
# Regenerate Prisma client
docker-compose exec payment-gateway npx prisma generate

# Reset database
docker-compose exec payment-gateway npx prisma db push --force-reset
```

### Nginx issues
```bash
# Test nginx configuration
docker-compose exec nginx nginx -t

# Reload nginx
docker-compose exec nginx nginx -s reload
```

## Production Checklist

- [ ] SSL certificate installed and configured
- [ ] Firewall rules configured
- [ ] Database backups automated
- [ ] Monitoring and alerting setup
- [ ] Log rotation configured
- [ ] .env file secured with proper values
- [ ] Security group rules minimized
- [ ] Regular update schedule established
- [ ] Error handling tested
- [ ] Load testing completed

## Support

For issues or questions:
- Check logs: `docker-compose logs -f`
- Review API documentation in `apis.text`
- Check database: `docker-compose exec payment-gateway npx prisma studio`

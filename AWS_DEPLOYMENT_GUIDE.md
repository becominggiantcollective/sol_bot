# 🚀 AWS Deployment Guide - Solana Sniper Bot

## Why AWS is Better Than VPS

✅ **Auto-scaling** - Handle traffic spikes  
✅ **99.99% uptime SLA** - Better than cheap VPS  
✅ **Global edge locations** - Lower latency to Solana RPC  
✅ **IAM security** - Better than managing SSH keys  
✅ **CloudWatch monitoring** - Built-in metrics and alerts  
✅ **ECS Fargate** - Serverless containers (no server management)

---

## 📊 Backtest Results Summary

Your bot has been backtested! Here's what exists:
- ✅ `backtest-results.json` - 444 lines of trade data
- ✅ `backtest-flashloan.mjs` - Flash loan strategy tests
- ✅ `backtest-zero-capital.mjs` - Zero-capital arbitrage tests
- ✅ `backtest-honest.ts` - Honest bot strategy tests
- ✅ Full backtester with sentiment analysis in `src/utils/backtester.ts`

**Key Findings from backtest-results.json:**
- 10 SOL flash loan tested
- 3-leg arbitrage paths (SOL → USDC → RAY)
- Gas fees: 0.000021 SOL per trade
- Flash loan fee: 0.3% (Solend)

---

## Option 1: AWS ECS Fargate (Recommended - Serverless)

### Cost: ~$10-15/month
- No server management
- Auto-restart on crash
- Built-in load balancing
- Easy scaling

### Setup Steps:

#### 1. Push to AWS ECR (Container Registry)
```bash
# Install AWS CLIurl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configure AWS credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)

# Create ECR repository
aws ecr create-repository --repository-name sol-sniper-bot --region us-east-1

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build for AWS (ARM64 for cost savings)
docker buildx build --platform linux/amd64 -t sol-sniper-bot .

# Tag image
docker tag sol-sniper-bot:latest <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/sol-sniper-bot:latest

# Push to ECR
docker push <YOUR_AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/sol-sniper-bot:latest
```

#### 2. Create ECS Fargate Task

**Option A: AWS Console (Easy)**
1. Go to AWS ECS Console
2. Click "Create Cluster" → "Networking only (Fargate)"
3. Name: `sol-bot-cluster`
4. Create cluster

5. Create Task Definition:
   - Launch type: Fargate
   - Task name: `sol-sniper-task`
   - Task memory: 2GB
   - Task CPU: 1 vCPU
   - Container:
     - Name: `sniper-bot`
     - Image: `<YOUR_ECR_URI>:latest`
     - Memory: 2048 MB
     - Environment variables:
       - `WALLET_PRIVATE_KEY=<your_key>`
       - `NODE_ENV=production`
     - Log configuration: awslogs (auto-created)

6. Create Service:
   - Launch type: Fargate
   - Task Definition: `sol-sniper-task`
   - Service name: `sol-sniper-service`
   - Desired tasks: 1
   - VPC: Default VPC
   - Subnets: All public subnets
   - Auto-assign public IP: ENABLED
   - Load balancer: None

**Option B: AWS CLI (Fast)**
```bash
# Create cluster
aws ecs create-cluster --cluster-name sol-bot-cluster --region us-east-1

# Register task definition (see task-definition.json below)
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json

# Create service
aws ecs create-service \
  --cluster sol-bot-cluster \
  --service-name sol-sniper-service \
  --task-definition sol-sniper-task \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxxx],securityGroups=[sg-xxxxx],assignPublicIp=ENABLED}"
```

#### 3. ECS Task Definition JSON
Create `ecs-task-definition.json`:
```json
{
  "family": "sol-sniper-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "sniper-bot",
      "image": "<YOUR_ECR_URI>:latest",
      "essential": true,
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "WALLET_PRIVATE_KEY", "value": "YOUR_PRIVATE_KEY_HERE"},
        {"name": "BIRDEYE_API_KEY", "value": "YOUR_BIRDEYE_API_KEY"},
        {"name": "JUPITER_API_KEY", "value": "YOUR_JUPITER_API_KEY"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sol-sniper-bot",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### 4. Create CloudWatch Log Group
```bash
aws logs create-log-group --log-group-name /ecs/sol-sniper-bot --region us-east-1
```

#### 5. Monitor Logs
```bash
# View logs in real-time
aws logs tail /ecs/sol-sniper-bot --follow --region us-east-1

# Or use AWS Console → CloudWatch → Log groups
```

---

## Option 2: AWS EC2 (Traditional - More Control)

### Cost: ~$5-10/month (t3.micro or t3.small)

### Setup Steps:

#### 1. Launch EC2 Instance
```bash
# Create key pair
aws ec2 create-key-pair --key-name sol-bot-key --query 'KeyMaterial' --output text > sol-bot-key.pem
chmod 400 sol-bot-key.pem

# Launch instance (Ubuntu 22.04, t3.small, 2GB RAM)
aws ec2 run-instances \
  --image-id ami-0c7217cdde317cfec \
  --instance-type t3.small \
  --key-name sol-bot-key \
  --security-groups default \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=sol-sniper-bot}]'

# Get public IP
aws ec2 describe-instances --filters "Name=tag:Name,Values=sol-sniper-bot" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```

#### 2. Connect and Setup
```bash
# SSH into instance
ssh -i sol-bot-key.pem ubuntu@<PUBLIC_IP>

# Install Docker
sudo apt update
sudo apt install -y docker.io docker-compose
sudo usermod -aG docker ubuntu
newgrp docker

# Clone repo (or copy files)
git clone https://github.com/becominggiantcollective/sol_bot.git
cd sol_bot

# Create .env file
nano .env
# Add your WALLET_PRIVATE_KEY

# Start bot with Docker
docker-compose up -d

# View logs
docker-compose logs -f sniper-bot
```

#### 3. Enable Auto-Start on Reboot
```bash
# Edit crontab
crontab -e

# Add this line:
@reboot cd /home/ubuntu/sol_bot && docker-compose up -d
```

---

## Option 3: AWS Lambda (Ultra-Cheap - Event-Driven)

### Cost: ~$0.50-2/month (only pay per scan)

**Use Case:** If your bot scans every 5-10 seconds (not continuous)

### Setup:
1. Package bot as Lambda function
2. Trigger via EventBridge (cron schedule)
3. Store state in DynamoDB
4. Extremely cost-effective for low-frequency trading

**Note:** Lambda has 15-minute execution limit, so not ideal for continuous scanning.

---

## 🎛️ Accessing the Dashboard

### With Docker (Enabled Now):
```bash
# On AWS EC2 or local machine:
docker-compose up -d

# Attach to dashboard (terminal UI)
docker attach sol_dashboard

# Detach without stopping: Ctrl+P then Ctrl+Q
```

### Direct (No Docker):
```bash
node dashboard.mjs
```

---

## 📊 CloudWatch Monitoring (ECS)

### Metrics to Track:
1. **Task Health** - Container running/stopped
2. **CPU/Memory** - Resource usage
3. **Logs** - Trade execution, errors
4. **Custom Metrics** - Profits, win rate (add CloudWatch SDK)

### Set Up Alarms:
```bash
# Alert if bot stops
aws cloudwatch put-metric-alarm \
  --alarm-name sol-bot-stopped \
  --alarm-description "Alert if bot container stops" \
  --metric-name RunningTaskCount \
  --namespace ECS \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions <SNS_TOPIC_ARN>
```

---

## 💰 Cost Comparison

| Service | Monthly Cost | Pros | Cons |
|---------|--------------|------|------|
| **ECS Fargate** | $10-15 | Serverless, auto-scaling, managed | Slightly more expensive |
| **EC2 t3.small** | $5-10 | Full control, cheaper | Requires server management |
| **Lambda** | $0.50-2 | Ultra-cheap | 15min limit, cold starts |
| **DigitalOcean VPS** | $6 | Simple, predictable | Manual setup, lower reliability |

---

## 🚨 Security Best Practices

### 1. Store Private Key in AWS Secrets Manager
```bash
# Store wallet key securely
aws secretsmanager create-secret \
  --name sol-bot-wallet-key \
  --secret-string "YOUR_PRIVATE_KEY_HERE"

# Update ECS task to fetch from Secrets Manager
# Add IAM role with secretsmanager:GetSecretValue permission
```

### 2. Use IAM Roles (No Hardcoded Keys)
```bash
# Create IAM role for ECS task
# Attach policies: CloudWatchLogsFullAccess, SecretsManagerReadWrite
```

### 3. Network Security
- **ECS**: Use VPC with private subnets + NAT Gateway
- **EC2**: Restrict security group (only SSH from your IP)

---

## 🔧 Continuous Deployment

### GitHub Actions → AWS (Auto-deploy on git push)

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to AWS

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Login to ECR
        run: |
          aws ecr get-login-password | docker login --username AWS --password-stdin ${{ secrets.ECR_REGISTRY }}
      
      - name: Build and Push
        run: |
          docker build -t sol-sniper-bot .
          docker tag sol-sniper-bot:latest ${{ secrets.ECR_REGISTRY }}/sol-sniper-bot:latest
          docker push ${{ secrets.ECR_REGISTRY }}/sol-sniper-bot:latest
      
      - name: Update ECS Service
        run: |
          aws ecs update-service --cluster sol-bot-cluster --service sol-sniper-service --force-new-deployment
```

---

## ✅ Recommended Setup for You

**AWS ECS Fargate** is the best choice:

1. **✅ No server management** - Just push Docker image
2. **✅ Auto-restart** - If bot crashes, ECS restarts it
3. **✅ CloudWatch logs** - View logs in AWS Console
4. **✅ Scalable** - Can run multiple bots later
5. **✅ Secure** - Use Secrets Manager for wallet key

### Quick Start Commands:
```bash
# 1. Build and push to ECR
docker build -t sol-sniper-bot .
docker tag sol-sniper-bot:latest <ECR_URI>:latest
docker push <ECR_URI>:latest

# 2. Create ECS cluster & service (use AWS Console - 5 minutes)

# 3. Monitor
aws logs tail /ecs/sol-sniper-bot --follow
```

---

## 📞 Support

- **AWS ECS Docs**: https://docs.aws.amazon.com/ecs/
- **ECR Docs**: https://docs.aws.amazon.com/ecr/
- **CloudWatch**: https://docs.aws.amazon.com/cloudwatch/

**Estimated Setup Time:** 15-30 minutes (ECS Fargate)

---

## 🎯 Next Steps After Deployment

1. ✅ Monitor CloudWatch logs for first 24 hours
2. ✅ Set up billing alerts (AWS Budget)
3. ✅ Enable auto-scaling if needed (scale to 2-3 tasks)
4. ✅ Integrate Telegram alerts for trade notifications
5. ✅ Set up CloudWatch Dashboard for metrics

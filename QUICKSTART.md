# Quick Start Guide

This guide will help you get the SSV APR service up and running quickly.

## Step 1: Prerequisites

Make sure you have:
- Node.js 18+ installed
- pnpm installed (`npm install -g pnpm`)
- Docker installed and running

## Step 2: Configuration

1. Copy the environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and update these critical values:

```env
# Get an RPC URL from Alchemy or Infura
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY_HERE

# Add the SSV staking contract address
STAKING_CONTRACT_ADDRESS=0xYOUR_CONTRACT_ADDRESS_HERE
```

## Step 3: Start the Database

```bash
docker-compose up -d
```

Wait a few seconds for PostgreSQL to initialize.

## Step 4: Install Dependencies

```bash
pnpm install
```

## Step 5: Start the Service

```bash
pnpm run start:dev
```

You should see output like:
```
[Bootstrap] Application is running on: http://localhost:3000/api
[Bootstrap] Health check: http://localhost:3000/api/apr/health
```

## Step 6: Test the Service

### Check Health
```bash
curl http://localhost:3000/api/apr/health
```

Expected response:
```json
{
  "status": "ok",
  "hasData": false,
  "latestSampleTimestamp": null
}
```

### Collect First Sample (Manual)
```bash
curl -X POST http://localhost:3000/api/apr/collect
```

Wait 1-2 minutes, then collect a second sample:
```bash
curl -X POST http://localhost:3000/api/apr/collect
```

### Check Current APR
```bash
curl http://localhost:3000/api/apr/current
```

You should now see APR data!

## Next Steps

- The cron job will automatically collect samples every 24 hours
- Access the API endpoints documented in README.md
- Monitor logs for any errors or warnings

## Troubleshooting

### "Connection refused" error
- Make sure Docker is running
- Check if PostgreSQL is up: `docker-compose ps`

### "Failed to read accEthPerShare"
- Verify your RPC_URL is correct and active
- Check STAKING_CONTRACT_ADDRESS is correct
- Ensure you have network connectivity

### "CoinGecko API error"
- CoinGecko may be rate limiting
- Wait a few minutes and try again
- Consider adding a CoinGecko API key (optional)

## Useful Commands

```bash
# View logs
docker-compose logs -f postgres

# Stop database
docker-compose down

# Reset database (delete all data)
docker-compose down -v

# View all APR samples
curl http://localhost:3000/api/apr/history?limit=100

# Get latest 2 samples
curl http://localhost:3000/api/apr/latest
```

# SSV APR Service

A NestJS microservice that calculates and tracks the Annual Percentage Rate (APR) for SSV staking rewards.

## Features

- **Automated 24h APR Calculation**: Cron job runs every 24 hours to sample and calculate APR
- **Blockchain Integration**: Reads `accEthPerShare` from the SSV staking contract
- **CoinGecko Integration**: Fetches 24-hour average prices for ETH and SSV (not spot prices)
- **PostgreSQL Storage**: Stores historical APR samples with timestamps
- **REST API**: Exposes endpoints to query current and historical APR data

## APR Calculation Formula

```
APR = (ΔIndex / ΔTime) × (ETH_Price / SSV_Price) × 31,536,000 × 100
```

Where:
- `ΔIndex` = change in `accEthPerShare` between two samples
- `ΔTime` = seconds between samples (unix timestamps)
- `ETH_Price` and `SSV_Price` are 24-hour average prices from CoinGecko
- `31,536,000` = seconds in a year (365 days)

## Prerequisites

- Node.js >= 18
- pnpm
- Docker & Docker Compose (for PostgreSQL)
- Ethereum RPC endpoint (Alchemy, Infura, etc.)

## Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
```

## Configuration

Edit `.env` file with your configuration:

```env
# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=ssv_user
DATABASE_PASSWORD=ssv_password
DATABASE_NAME=ssv_apr

# Blockchain
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
STAKING_CONTRACT_ADDRESS=0x...  # SSV staking contract address

# CoinGecko
COINGECKO_API_URL=https://api.coingecko.com/api/v3

# Explorer Center (Hoodi)
EXPLORER_CENTER_HOODI=

# Cron Schedule (every 24 hours at midnight UTC)
APR_CALCULATION_CRON=0 0 * * *

# App
PORT=3000
NODE_ENV=development
```

## Running the Service

### 1. Start PostgreSQL

```bash
docker-compose up -d
```

### 2. Start the Application

```bash
# Development mode
pnpm run start:dev

# Production mode
pnpm run build
pnpm run start:prod
```

The service will be available at `http://localhost:3000/api`

## API Endpoints

### Get Current APR

```bash
GET /api/apr/current
```

**Response:**
```json
{
  "currentApr": "12.45",
  "timestamp": "2024-01-15T00:00:00.000Z",
  "ethPrice": "2450.50",
  "ssvPrice": "45.20",
  "accEthPerShare": "1234567890123456789",
  "deltaIndex": "987654321",
  "deltaTime": 86400
}
```

### Get Latest Two Samples

```bash
GET /api/apr/latest
```

Returns the two most recent APR samples (as required by the UI spec).

**Response:**
```json
{
  "samples": [
    {
      "id": "uuid",
      "timestamp": "2024-01-15T00:00:00.000Z",
      "accEthPerShare": "1234567890123456789",
      "ethPrice": "2450.50",
      "ssvPrice": "45.20",
      "currentApr": "12.45",
      "deltaIndex": "987654321",
      "deltaTime": 86400,
      "createdAt": "2024-01-15T00:05:00.000Z"
    },
    {
      "id": "uuid",
      "timestamp": "2024-01-14T00:00:00.000Z",
      "accEthPerShare": "1234567890000000000",
      "ethPrice": "2400.00",
      "ssvPrice": "44.80",
      "currentApr": "11.80",
      "deltaIndex": "876543210",
      "deltaTime": 86400,
      "createdAt": "2024-01-14T00:05:00.000Z"
    }
  ],
  "count": 2
}
```

### Get Historical Samples

```bash
GET /api/apr/history?limit=30&startDate=2024-01-01&endDate=2024-01-31
```

**Query Parameters:**
- `limit` (optional): Number of samples to return (default: 30)
- `startDate` (optional): ISO 8601 date string
- `endDate` (optional): ISO 8601 date string

**Response:**
```json
{
  "samples": [...],
  "count": 30
}
```

### Manual Sample Collection

```bash
POST /api/apr/collect
```

Manually trigger APR sample collection (useful for testing or admin operations).

**Response:**
```json
{
  "message": "APR sample collected successfully",
  "sample": { ... }
}
```

### Health Check

```bash
GET /api/apr/health
```

**Response:**
```json
{
  "status": "ok",
  "hasData": true,
  "latestSampleTimestamp": "2024-01-15T00:00:00.000Z"
}
```

## Scheduled Jobs

### APR Collection (Daily)

- **Schedule**: Every day at midnight UTC (configurable via `APR_CALCULATION_CRON`)
- **Action**:
  1. Reads `accEthPerShare` from blockchain
  2. Fetches 24h average prices from CoinGecko
  3. Calculates APR using the formula
  4. Stores sample in database

### Cleanup (Weekly)

- **Schedule**: Every week
- **Action**: Removes samples older than 365 days

## Database Schema

### apr_samples

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| timestamp | TIMESTAMP | Sample collection time |
| accEthPerShare | NUMERIC(78,18) | Value from blockchain |
| ethPrice | NUMERIC(18,8) | 24h average ETH price (USD) |
| ssvPrice | NUMERIC(18,8) | 24h average SSV price (USD) |
| currentApr | NUMERIC(10,2) | Calculated APR percentage |
| deltaIndex | NUMERIC(78,18) | Change in accEthPerShare |
| deltaTime | BIGINT | Seconds between samples |
| createdAt | TIMESTAMP | Record creation time |

## Data Sources

### Blockchain
- **Contract**: SSV Staking Contract
- **Method**: `accEthPerShare()`
- **Network**: Ethereum Mainnet

### Explorer Center (Hoodi)
- **Validators Effective Balance**: `GET /validators/effective-balance`
- **Clusters Effective Balance**: `GET /clusters/effective-balance`

### CoinGecko
- **Endpoint**: `/coins/{id}/market_chart`
- **Tokens**:
  - `ethereum` (ETH)
  - `ssv-network` (SSV)
- **Period**: 24 hours with hourly intervals
- **Calculation**: Average of all hourly price points

## Development

```bash
# Run tests
pnpm test

# Run e2e tests
pnpm test:e2e

# Lint
pnpm lint

# Format
pnpm format
```

## Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up --build
```

## Monitoring

- Check service health: `GET /api/apr/health`
- View logs: Check NestJS console output
- Database: Connect to PostgreSQL to inspect `apr_samples` table

## Troubleshooting

### APR shows null
- Need at least 2 samples to calculate APR
- Wait for the second cron job run (24 hours after first sample)
- Or manually trigger: `POST /api/apr/collect` twice with 1+ minute delay

### Blockchain connection errors
- Verify RPC_URL is correct and accessible
- Check STAKING_CONTRACT_ADDRESS is correct
- Ensure RPC provider has sufficient rate limits

### CoinGecko API errors
- CoinGecko free tier has rate limits
- Consider adding API key for higher limits
- Service automatically retries failed requests

## License

MIT

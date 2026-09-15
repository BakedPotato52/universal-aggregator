# ⚡ Universal Aggregator (Direct UPI & Acquiring Bank Orchestrator)

An enterprise-grade **Universal Payment Aggregator & Orchestration Engine** built in **Node.js / TypeScript**. It provides direct connectivity to Indian Acquiring Banks (**HDFC Bank**, **ICICI Bank**, **Axis Bank**) and the direct **NPCI UPI Stack** (Dynamic QR, App Intent Deep Links, Collect, S2S Webhooks, and 3-Way Auto-Reconciliation).

Unlike third-party master aggregators that hold funds in escrow and charge intermediary cuts, this engine processes payments directly under your dedicated bank Merchant IDs (MIDs) with funds settling straight into your company current account.

---

## Architecture Diagram

```mermaid
flowchart TD
    Customer([Customer / Client App]) -->|Checkout / Payment Intent| UniversalAggregator[Universal Aggregator Core]
    
    subgraph CoreEngine ["Universal Aggregator Engine"]
        Idempotency[Idempotency Manager (X-Idempotency-Key & Locks)]
        Router[Smart Routing & Fallback Engine]
        Ledger[Transaction Ledger & State Machine]
        Crypto[Bank Cryptography & Signature Engine]
        Outbox[Transactional Outbox & Retry Queue]
    end

    UniversalAggregator --> Idempotency
    Idempotency --> Router
    Router --> Ledger

    subgraph DirectUPI ["Direct UPI Stack"]
        QRGen[Dynamic QR Generator (SVG/PNG Data URL)]
        IntentGen[Intent Deep Links (GPay, PhonePe, Paytm, CRED, BHIM)]
        CollectAPI[UPI Collect VPA Handler]
    end

    Ledger --> DirectUPI

    subgraph BankAdapters ["Direct Acquiring Bank Integrations"]
        HDFC[HDFC Bank Direct SmartHub / UPI]
        ICICI[ICICI Bank Eazypay Composite Stack]
        Axis[Axis Bank Direct UPI Gateway]
        MockBank[Sandbox Bank Simulator]
    end

    DirectUPI --> BankAdapters
    BankAdapters --> BankAPIs[(Acquiring Bank / NPCI Switch)]

    subgraph ReconEngine ["Reconciliation & S2S Webhooks"]
        BankCallbacks[Inbound S2S Bank Webhook Listener]
        MerchantWebhook[Outbound Merchant Webhook (Signed HMAC)]
        AutoRecon[3-Way Bank MIS Settlement Matcher]
    end

    BankAPIs -.->|S2S Webhook Callback| BankCallbacks
    BankCallbacks --> Ledger
    Ledger --> Outbox
    Outbox --> MerchantWebhook
    MerchantWebhook -.->|POST /merchant/webhook| Customer
    AutoRecon --> Ledger
```

---

## Key Modules

### 1. Direct UPI Engine (`src/upi/`)
- **NPCI Compliant URI Builder (`src/upi/uri-builder.ts`):** Formats standard `upi://pay?pa=...&pn=...&mc=...&tr=...&tn=...&am=...&cu=INR&mode=02` URI strings.
- **Dynamic QR Code Generator (`src/upi/qr-generator.ts`):** Renders Dynamic UPI QR codes (Base64 PNG DataURL, SVG, ANSI terminal strings).
- **Intent Deep Link Engine (`src/upi/intent.ts`):** Generates mobile deep links for **Google Pay** (`tez://`), **PhonePe** (`phonepe://`), **Paytm** (`paytmmp://`), **CRED** (`cred://`), **BHIM** (`bhim://`), and generic fallback.
- **Cryptographic Engine (`src/upi/crypto.ts`):** Implements HMAC-SHA256 checksums, AES-256-CBC/GCM payload encryption, and RSA-SHA256 signature verification.
- **VPA Validator (`src/upi/validator.ts`):** Validates and parses customer VPAs against NPCI rules and known bank PSP handles.

### 2. Core Orchestration Engine (`src/core/`)
- **Idempotency Manager (`src/core/idempotency/idempotency.manager.ts`):** Deduplicates requests via `X-Idempotency-Key`, atomic execution locks, and response caching.
- **Smart Router (`src/core/routing/router.ts`):** Dynamically scores bank channels based on success rates and latency, handling seamless fallback routing.
- **Transaction Ledger (`src/core/ledger/transaction.service.ts`):** Manages strict state transitions (`INITIATED` -> `PENDING` -> `SUCCESS` / `FAILED` / `REFUNDED`) and audit history.
- **Transactional Outbox (`src/core/outbox/outbox.service.ts`):** Delivers merchant webhooks reliably with exponential backoff and HMAC signatures.

### 3. Direct Bank Adapters (`src/adapters/`)
- **HDFC Bank Direct (`src/adapters/hdfc/`):** SmartHub / UPI Direct adapter with payload checksums.
- **ICICI Bank Direct (`src/adapters/icici/`):** Eazypay Direct adapter with AES-256-CBC payload encryption.
- **Axis Bank Direct (`src/adapters/axis/`):** Merchant UPI direct gateway adapter.
- **Sandbox Bank Simulator (`src/adapters/mock/`):** Realistic local simulator for testing full checkout, scanning, and S2S callbacks.

### 4. 3-Way Automated Reconciliation (`src/reconciliation/`)
- **Bank MIS Settlement Parser (`src/reconciliation/parser.ts`):** Ingests end-of-day bank settlement CSV statements.
- **Reconciliation Matcher (`src/reconciliation/matcher.ts`):** Compares internal orders against bank settlement records, detects amount mismatches, flags unclaimed credits, and auto-heals dropped webhooks.

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node.js v24)
- npm 9+

### Installation
```bash
# Clone and enter directory
cd universal-aggregator

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
```

### Running Locally
```bash
# Start development server with live reload
npm run dev

# Or build and start production server
npm run build
npm start
```

Server will start on `http://localhost:3000`.

---

## Interactive Developer Sandbox

Visit **`http://localhost:3000/demo/index.html`** in your browser to access the Developer Sandbox:
1. **Dynamic QR Checkout:** Generate dynamic QR codes, inspect NPCI URIs, and test Google Pay / PhonePe deep links.
2. **Customer Simulator:** Simulate customer scanning the QR code, entering UPI PIN, and firing instant S2S bank callbacks.
3. **Reconciliation Playground:** Ingest Bank MIS CSV statements and visualize 3-way reconciliation reports.
4. **Live Switch Health:** Monitor real-time success rates and latency of direct acquiring bank connectors.

---

## REST API Reference

### 1. Generate Dynamic UPI QR
```http
POST /api/v1/payments/upi/qr
Headers:
  Content-Type: application/json
  X-Idempotency-Key: ORD_1001

Body:
{
  "merchantOrderId": "ORD_1001",
  "amount": 499.00,
  "description": "Order #1001 Payment",
  "preferredBank": "MOCK"
}
```

### 2. Generate UPI Intent Deep Links
```http
POST /api/v1/payments/upi/intent
Headers:
  Content-Type: application/json

Body:
{
  "merchantOrderId": "ORD_1002",
  "amount": 250.00,
  "description": "In-App Checkout"
}
```

### 3. S2S Bank Webhook Callback
```http
POST /api/v1/webhooks/bank/MOCK
Headers:
  Content-Type: application/json
  X-Bank-Signature: <HMAC_SIGNATURE>

Body:
{
  "orderId": "ORD_1001",
  "amount": "499.00",
  "status": "SUCCESS",
  "responseCode": "00",
  "rrn": "RRN99882211",
  "payerVpa": "customer@okhdfcbank"
}
```

### 4. Query Payment Status
```http
GET /api/v1/payments/:transactionId/status
```

### 5. Execute 3-Way Reconciliation
```http
POST /api/v1/reconciliation/reconcile-csv
Headers:
  Content-Type: application/json

Body:
{
  "csvContent": "MerchantOrderId,BankReferenceId,Amount,Fee,Tax,NetSettledAmount,Status,SettlementDate\nORD_1001,RRN99882211,499.00,0.00,0.00,499.00,SUCCESS,2026-09-15",
  "bankCode": "MOCK",
  "autoHealPending": true
}
```

---

## Running Automated Tests

```bash
# Run all unit and integration test suites
npm test
```

Test coverage includes:
- NPCI UPI URI specifications & encoding
- Dynamic QR code generation (SVG, PNG DataURL)
- Mobile App Intent deep link generation
- Bank cryptography (HMAC-SHA256, SHA256 checksums, AES-256-CBC, AES-256-GCM)
- Idempotency locking, concurrency deduplication, and cached response verification
- Transaction Ledger state transitions & audit logs
- 3-Way Reconciliation Matching & Auto-healing
- Full HTTP End-to-End lifecycle (Create QR -> Webhook Callback -> Query Status -> Refund)

---

## License
MIT

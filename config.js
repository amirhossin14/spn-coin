/**
 * ─────────────────────────────────────────────────────────────
 *  © 2026 SPN Coin Project — PROPRIETARY AND CONFIDENTIAL
 *  All Rights Reserved. Unauthorized copying, modification,
 *  distribution, or use of this file is strictly prohibited.
 *  See LICENSE file in the project root for full details.
 * ─────────────────────────────────────────────────────────────
 */
// ═══════════════════════════════════════════════════════════════
//  ⚙️  SPN Coin Configuration — All settings in one place
// ═══════════════════════════════════════════════════════════════

const COIN = {
    NAME:           'SPN Coin',
    SYMBOL:         'SPN',
    DECIMALS:       8,                 // 8 decimal places (like Bitcoin)
    ADDRESS_PREFIX: 'SPN',
    WEBSITE:        'https://spncoin.example.com',
    VERSION:        '6.5.1',
};

// ═══════════════════════════════════════════════════════════════
//  🏷️  ADDRESS IDENTITY — change these to rebrand your coin's address
//
//  FORMAT options:
//    'base58check' → Bitcoin-style, e.g. "SPN1BMcLPbjc..."  (mixed case)
//    'bech32'      → modern, e.g. "spn1q…"   (lowercase, stronger checksum)
//
//  NOTE: changing any of these is a CONSENSUS-BREAKING change. Existing
//  addresses and chain data become invalid — reset ./data and re-mine the
//  genesis block on a fresh testnet before using the new format.
// ═══════════════════════════════════════════════════════════════
const ADDRESS = {
    FORMAT: 'base58check',             // 'base58check' | 'bech32'

    // ── base58check settings ──
    PREFIX_MAINNET:  'SPN1',           // brand string prepended to mainnet addrs
    PREFIX_TESTNET:  'SPNt',           // brand string prepended to testnet addrs
    VERSION_MAINNET: 0x19,             // version byte (shapes the leading char)
    VERSION_TESTNET: 0x6F,

    // ── bech32 settings (used when FORMAT === 'bech32') ──
    HRP_MAINNET:     'spn',            // human-readable part, e.g. spn1q...
    HRP_TESTNET:     'tspn',
};

const BLOCKCHAIN = {
    INITIAL_DIFFICULTY: 3,
    // Proof-of-Work hash algorithm:
    //   'sha256d' → Bitcoin-style (double SHA-256)
    //   'scrypt'  → Litecoin-style (scrypt N=1024, r=1, p=1)
    // NOTE: changing this is consensus-breaking — reset ./data and re-mine genesis.
    POW_ALGORITHM:      'sha256d',
    BLOCK_TIME_TARGET:  600_000,       // 10 minutes in ms (like Bitcoin)
    DIFFICULTY_WINDOW:  2016,          // Retarget every 2016 blocks (like Bitcoin)
    MINING_REWARD:      50,            // Initial block reward in SPN
    HALVING_INTERVAL:   210_000,       // Halve reward every 210,000 blocks
    MAX_SUPPLY:         21_000_000,    // 21 million max supply
    MAX_BLOCK_SIZE:     1_000_000,     // 1MB
    MAX_BLOCK_TXS:      3_000,
    STARTING_BALANCE:   1_000,         // Initial wallet balance for testing
    COINBASE_MATURITY:  100,           // Blocks before coinbase can be spent
    MIN_DIFFICULTY:     1,
    MAX_DIFFICULTY:     64,
};

const NETWORK = {
    HTTP_PORT:     parseInt(process.env.PORT)           || 3000,
    STRATUM_PORT:  parseInt(process.env.STRATUM_PORT)   || 3333,
    P2P_PORT:      parseInt(process.env.P2P_PORT)       || 8333,
    MAX_PEERS:     parseInt(process.env.MAX_PEERS)      || 8,
    CHAIN_ID:      parseInt(process.env.CHAIN_ID)       || 1,   // 1=mainnet, 3=testnet
};

const MEMPOOL = {
    MAX_SIZE_BYTES: parseInt(process.env.MEMPOOL_MAX_SIZE) || 50_000_000,  // 50MB
    MAX_TXS:        parseInt(process.env.MEMPOOL_MAX_TXS)  || 10_000,
    TX_EXPIRY_MS:   parseInt(process.env.TX_EXPIRY)        || 72 * 3600_000, // 72 hours
    MIN_FEE_RATE:   10,  // satoshis per byte
};

const SECURITY = {
    JWT_SECRET:      process.env.JWT_SECRET     || require('crypto').randomBytes(32).toString('hex'),
    ACCESS_KEY:      process.env.ACCESS_KEY     || require('crypto').randomBytes(32).toString('hex'),
    TOKEN_TTL_MS:    8 * 60 * 60 * 1000,        // 8 hours
    REFRESH_TTL_DAYS:30,
    MAX_LOGIN_FAILS: 5,
    LOCKOUT_MS:      15 * 60 * 1000,            // 15 minutes
    BCRYPT_ROUNDS:   10,
};

// ── Internal constants ──────────────────────────────────────────
const INITIAL_REWARD   = BigInt(process.env.INITIAL_REWARD || '5000000000'); // 50 SPN in satoshi
const HALVING_INTERVAL = BLOCKCHAIN.HALVING_INTERVAL;
const CHAIN_ID         = NETWORK.CHAIN_ID;
const REWARD_INPUT     = { address: '*authorized-reward*' };

// Paid token-issuance service: anyone can create a token by paying this fee
// (in SPN) to the treasury address, inside the same transaction that carries
// the signed issue op. 0 = free.
const TOKEN = {
    // Fee (in satoshi) a user pays to the treasury to create a TOKEN
    // (flexible / optionally mintable). Default 50 SPN.
    ISSUANCE_FEE: BigInt(process.env.TOKEN_ISSUANCE_FEE || '1000000000'), // 10 SPN
    // Fee to create a COIN (fixed supply, like Bitcoin). Coins are scarcer and
    // more serious, so they cost more by default. Default 25 SPN.
    COIN_ISSUANCE_FEE: BigInt(process.env.COIN_ISSUANCE_FEE || '2500000000'), // 25 SPN
    // ── Fee split: part of every issuance fee is BURNED (sent to an
    // unspendable address, removing it from supply — deflationary + real
    // anti-spam cost), the rest goes to the treasury wallet. Configurable
    // via FEE_BURN_BPS (basis points, 10000 = 100%). Default 7000 = 70% burn.
    FEE_BURN_BPS: BigInt(process.env.FEE_BURN_BPS || '7000'),
    // Unspendable burn address (base58check of version + 20 zero bytes — no
    // public key hashes to all-zero HASH160, so coins here can never be spent).
    BURN_ADDRESS: process.env.BURN_ADDRESS || 'SPN1B4T5ciTCkWauSqVAcVKy88ofjcSasUkSYU',
    // Anti-spam: max issuances allowed per issuer address per rolling 24h.
    ISSUE_DAILY_LIMIT: parseInt(process.env.ISSUE_DAILY_LIMIT || '2', 10),
    // Treasury address that collects issuance fees (the project's revenue).
    // IMPORTANT: left empty here so the fee is only enforced once you set a real
    // TREASURY_ADDRESS in your .env. When empty, creation is free (this keeps
    // tests and local dev working). Set TREASURY_ADDRESS in production to
    // start collecting fees. See TREASURY_WALLET.txt for the project wallet.
    // Left empty here so unit tests and local dev (which call the token layer
    // directly) keep issuance free. The RUNNING SERVER still sets the treasury to
    // the project's MAIN_ADDRESS at startup (see server.js → setTreasury), so in
    // production the coin/token fee IS collected to that fixed address.
    TREASURY:     process.env.TREASURY_ADDRESS || '',
};
const SATOSHI          = 100_000_000n;

const GENESIS_DATA = {
    timestamp:  1,
    lastHash:   '------',
    hash:       'hash-one',
    difficulty: BLOCKCHAIN.INITIAL_DIFFICULTY,
    nonce:      0,
    data:       [],
};

module.exports = {
    COIN,
    ADDRESS,
    BLOCKCHAIN,
    NETWORK,
    MEMPOOL,
    SECURITY,
    GENESIS_DATA,
    INITIAL_REWARD,
    HALVING_INTERVAL,
    CHAIN_ID,
    SATOSHI,
    REWARD_INPUT,
    TOKEN,
    // Legacy aliases
    MINE_RATE:        BLOCKCHAIN.BLOCK_TIME_TARGET,
    STARTING_BALANCE: BLOCKCHAIN.STARTING_BALANCE,
    MINING_REWARD:    BLOCKCHAIN.MINING_REWARD,
    INITIAL_DIFFICULTY: BLOCKCHAIN.INITIAL_DIFFICULTY,
};

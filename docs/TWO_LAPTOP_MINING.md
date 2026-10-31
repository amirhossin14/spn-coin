# Two-Laptop Mining Test Guide

This guide shows how to test and mine the SPN network using a second laptop.

──────────────────────────────────────────────────────────────

## Prerequisites
- Both laptops connected to the same Wi-Fi network
- Node.js installed on both
- The SPN_Coin project extracted on both

## Step 1 — Find the IP address of the first laptop

On the **first laptop**, open a CMD and run:

    ipconfig

Look for "IPv4 Address". Something like:  192.168.1.100
This is the first laptop's IP. Note it down.

═══════════════════════════════════════════════════════════════
##  Method 1 — Simplest (browser only, no second node)
═══════════════════════════════════════════════════════════════

### First laptop:
    npm start
(The server comes up on localhost:3000)

### Second laptop:
Open a browser and go to the first laptop's address:

    http://192.168.1.100:3000/miner.html

(Replace 192.168.1.100 with the first laptop's real IP)

→ Now click the Start Mining button. The second laptop mines for the network.

═══════════════════════════════════════════════════════════════
##  Method 2 — Full node on the second laptop (like a real network)
═══════════════════════════════════════════════════════════════

Here the second laptop becomes an independent node that syncs with the first laptop.

### First laptop (main node / seed):

Windows (CMD):
    set P2P_PORT=8333
    npm start

Linux/Mac:
    P2P_PORT=8333 npm start

### Second laptop (node that connects to the first):

Windows (CMD):
    set PORT=3001
    set P2P_PORT=8334
    set PEERS=http://192.168.1.100:8333
    npm start

Linux/Mac:
    PORT=3001 P2P_PORT=8334 PEERS=http://192.168.1.100:8333 npm start

(Replace 192.168.1.100 with the first laptop's IP)

→ Now the second laptop connects to the first and syncs the blocks.
→ On the second laptop, go to  http://localhost:3001/miner.html  and mine.
→ The blocks mined by the second laptop are also visible on the first laptop!

═══════════════════════════════════════════════════════════════
##  Important notes
═══════════════════════════════════════════════════════════════

1. SPN's mining algorithm is the same as Bitcoin (SHA-256d).
   → For testing, mining with the laptop's CPU is enough.
   → A physical miner (ASIC) is only needed for a real, large network.

2. If the second laptop doesn't connect:
   → Check the Windows firewall (it may block the port)
   → Make sure both are on the same Wi-Fi
   → Make sure you entered the IP correctly

3. To see the network status:  http://localhost:3000/network.html

4. Ports:
   - 3000/3001 → web interface (HTTP)
   - 8333/8334 → node-to-node communication (P2P)
   - 3333      → Stratum (for professional miners)

═══════════════════════════════════════════════════════════════
##  Physical miner (ASIC) — for the future
═══════════════════════════════════════════════════════════════

Because SPN uses SHA-256d and the Stratum protocol, Bitcoin miners
(Antminer, WhatsMiner, etc.) are technically compatible.

ASIC miner configuration:
    URL:      stratum+tcp://<server IP>:3333
    Worker:   <your SPN address>
    Password: x

But keep in mind: an ASIC is not needed for testing — it is expensive and power-hungry.
Only think about it once your network is real and large.

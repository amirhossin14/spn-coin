/*
 * Deploy SpnCoinToken.
 *
 * The initial supply is sent to RECIPIENT_ADDRESS. For anything beyond a
 * throwaway test, RECIPIENT_ADDRESS MUST be a multisig (e.g. Gnosis Safe),
 * never a single hot wallet.
 *
 *   PRIVATE_KEY=...  RECIPIENT_ADDRESS=0x...  npm run deploy:baseSepolia
 */
const hre = require("hardhat");

async function main() {
  const recipient = process.env.RECIPIENT_ADDRESS;
  if (!recipient || !hre.ethers.isAddress(recipient)) {
    throw new Error("Set RECIPIENT_ADDRESS to a valid address (use a multisig).");
  }

  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  console.log(`Network : ${net}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Supply recipient: ${recipient}`);

  const Token = await hre.ethers.getContractFactory("SpnCoinToken");
  const token = await Token.deploy(recipient);
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log(`\n✅ SpnCoinToken deployed at: ${addr}`);
  console.log(`   name=${await token.name()} symbol=${await token.symbol()}`);
  console.log(`   totalSupply=${await token.totalSupply()}`);
  console.log(`\nVerify source on the explorer with:`);
  console.log(`   npx hardhat verify --network ${net} ${addr} ${recipient}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

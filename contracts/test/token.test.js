const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SpnCoinToken", function () {
  let token, owner, alice, bob;
  const MAX = 21_000_000n * 10n ** 18n;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("SpnCoinToken");
    token = await Token.deploy(owner.address);
    await token.waitForDeployment();
  });

  it("mints the full fixed supply to the recipient", async function () {
    expect(await token.totalSupply()).to.equal(MAX);
    expect(await token.balanceOf(owner.address)).to.equal(MAX);
    expect(await token.MAX_SUPPLY()).to.equal(MAX);
  });

  it("has correct metadata", async function () {
    expect(await token.name()).to.equal("SPN Coin");
    expect(await token.symbol()).to.equal("SPN");
    expect(await token.decimals()).to.equal(18);
  });

  it("rejects the zero address as recipient", async function () {
    const Token = await ethers.getContractFactory("SpnCoinToken");
    await expect(Token.deploy(ethers.ZeroAddress)).to.be.reverted;
  });

  it("transfers tokens", async function () {
    await token.transfer(alice.address, 1000n);
    expect(await token.balanceOf(alice.address)).to.equal(1000n);
  });

  it("burns tokens and reduces total supply", async function () {
    await token.burn(1000n);
    expect(await token.totalSupply()).to.equal(MAX - 1000n);
  });

  it("has NO mint function (supply is immutable)", async function () {
    expect(token.mint).to.equal(undefined);
  });

  it("supports EIP-2612 permit (gasless approval)", async function () {
    const value = 500n;
    const deadline = ethers.MaxUint256;
    const nonce = await token.nonces(owner.address);
    const domain = {
      name: "SPN Coin",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await token.getAddress(),
    };
    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };
    const sig = await owner.signTypedData(domain, types, {
      owner: owner.address,
      spender: alice.address,
      value,
      nonce,
      deadline,
    });
    const { v, r, s } = ethers.Signature.from(sig);
    await token.permit(owner.address, alice.address, value, deadline, v, r, s);
    expect(await token.allowance(owner.address, alice.address)).to.equal(value);
  });
});

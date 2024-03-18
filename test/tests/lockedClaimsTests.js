const C = require('../constants');
const { getSignature } = require('../helpers');
const setup = require('../fixtures');
const { expect } = require('chai');
const { time } = require('@nomicfoundation/hardhat-network-helpers');
const { createTree, getProof } = require('../merkleGenerator');
const { ethers } = require('hardhat');
const { v4: uuidv4, parse: uuidParse } = require('uuid');

const lockedTests = (params, lockupParams) => {
  let deployed, dao, a, b, c, d, e, token, claimContract, lockup, domain;
  let start, cliff, period, periods, end;
  let amount, remainder, campaign, claimLockup, claimA, claimB, claimC, claimD, claimE, id;
  it('DAO Creates a locked claim campaign', async () => {
    deployed = await setup(params.decimals);
    dao = deployed.dao;
    a = deployed.a;
    b = deployed.b;
    c = deployed.c;
    d = deployed.d;
    e = deployed.e;
    token = deployed.token;
    claimContract = deployed.claimContract;
    lockup = deployed.lockup;
    domain = deployed.claimDomain;
    let now = BigInt(await time.latest());
    start = lockupParams.start == 0 ? BigInt(0) : now;
    cliff = BigInt(lockupParams.cliff) + start;
    period = lockupParams.period;
    periods = BigInt(lockupParams.periods);
    end = start + periods;

    let treevalues = [];
    amount = BigInt(0);
    const uuid = uuidv4();
    id = uuidParse(uuid);
    for (let i = 0; i < params.totalRecipients; i++) {
      let wallet;
      let amt = C.randomBigNum(1000, 100, params.decimals);
      if (i == params.nodeA) {
        wallet = a.address;
        claimA = amt;
      } else if (i == params.nodeB) {
        wallet = b.address;
        claimB = amt;
      } else if (i == params.nodeC) {
        wallet = c.address;
        claimC = amt;
      } else if (i == params.nodeD) {
        wallet = d.address;
        claimD = amt;
      } else if (i == params.nodeE) {
        wallet = e.address;
        claimE = amt;
      } else {
        wallet = ethers.Wallet.createRandom().address;
      }
      amount = amt + amount;
      treevalues.push([wallet, amt.toString()]);
    }
    remainder = amount;
    const root = createTree(treevalues, ['address', 'uint256']);
    campaign = {
      manager: dao.address,
      token: token.target,
      amount,
      end: BigInt(await time.latest() + (60 * 60)),
      tokenLockup: 1,
      root,
    };
    claimLockup = {
      tokenLocker: lockup.target,
      start,
      cliff,
      period,
      periods,
    };
    const tx = await claimContract.createLockedCampaign(id, campaign, claimLockup, C.ZERO_ADDRESS);
    expect(tx).to.emit(claimContract, 'ClaimLockupCreated').withArgs(id, claimLockup);
    expect(tx).to.emit(claimContract, 'CampaignCreated').withArgs(id, campaign);
    expect(tx).to.emit(token, 'Transfer').withArgs(dao.target, claimContract.target, amount);
    expect(tx).to.emit(token, 'Approval').withArgs(claimContract.target, lockup.target, amount);
  });
  it('wallet A claims and delegates their tokens to itself using a real delegation signature', async () => {
    remainder = remainder - BigInt(claimA);
    let proof = getProof('./test/trees/tree.json', a.address);
    let delegatee = a.address;
    let expiry = BigInt(await time.latest()) + BigInt(60 * 60 * 24 * 7);
    let nonce = 0;
    const delegationValues = {
      delegatee,
      nonce,
      expiry,
    };
    const delegationSignature = await getSignature(a, domain, C.delegationtype, delegationValues);
    const delegationSig = {
      nonce,
      expiry,
      v: delegationSignature.v,
      r: delegationSignature.r,
      s: delegationSignature.s,
    };
    const tx = await claimContract.connect(a).claimAndDelegate(id, proof, claimA, delegatee, delegationSig);
    expect(tx).to.emit(claimContract, 'Claimed').withArgs(a.address, claimA);
    expect(tx).to.emit(claimContract, 'TokensClaimed').withArgs(id, a.address, claimA, remainder);
    expect(tx).to.emit(token, 'Transfer').withArgs(claimContract.target, lockup.target, claimA);
    let rate = claimA % periods == 0 ? BigInt(claimA / periods) : BigInt(claimA / periods) + BigInt(1);
    expect(tx)
      .to.emit(lockup, 'PlanCreated')
      .withArgs(1, a.address, token.target, claimA, start, cliff, end, rate, period);
    const votingVault = await lockup.votingVaults(1);
    expect(tx).to.emit(lockup, 'VotingVaultCreated').withArgs(1, votingVault);
    expect(await token.delegates(votingVault)).to.eq(delegatee);
    expect(await token.balanceOf(votingVault)).to.eq(claimA);
    expect(await lockup.ownerOf(1)).to.eq(a.address);
    const plan = await lockup.plans(1);
    expect(plan.amount).to.eq(claimA);
    expect(plan.token).to.eq(token.target);
    expect(plan.start).to.eq(start);
    expect(plan.cliff).to.eq(cliff);
    expect(plan.period).to.eq(period);
    expect(plan.rate).to.eq(rate);
  });
  it('wallet B claims and delegates its tokens to wallet A with a blank delegation signature', async () => {
    remainder = remainder - BigInt(claimB);
    let proof = getProof('./test/trees/tree.json', b.address);
    let delegatee = a.address;
    const bytes = ethers.encodeBytes32String('blank');
    const delegationSig = {
      nonce: 0,
      expiry: 0,
      v: 0,
      r: bytes,
      s: bytes,
    };
    const tx = await claimContract.connect(b).claimAndDelegate(id, proof, claimB, delegatee, delegationSig);
    expect(tx).to.emit(claimContract, 'Claimed').withArgs(b.address, claimB);
    expect(tx).to.emit(claimContract, 'TokensClaimed').withArgs(id, b.address, claimB, remainder);
    expect(tx).to.emit(token, 'Transfer').withArgs(claimContract.target, lockup.target, claimB);
    let rate = claimB % periods == 0 ? BigInt(claimB / periods) : BigInt(claimB / periods) + BigInt(1);
    expect(tx)
      .to.emit(lockup, 'PlanCreated')
      .withArgs(2, b.address, token.target, claimB, start, cliff, end, rate, period);
    const votingVault = await lockup.votingVaults(2);
    expect(tx).to.emit(lockup, 'VotingVaultCreated').withArgs(2, votingVault);
    expect(await token.delegates(votingVault)).to.eq(delegatee);
    expect(await token.balanceOf(votingVault)).to.eq(claimB);
    expect(await lockup.ownerOf(2)).to.eq(b.address);
  });
  it('DAO claims on behalf of wallet C and delegates to wallet C', async () => {
    remainder = remainder - BigInt(claimC);
    let proof = getProof('./test/trees/tree.json', c.address);
    let delegatee = c.address;
    let expiry = BigInt(await time.latest()) + BigInt(60 * 60 * 24 * 7);
    let nonce = 0;
    const txValues = {
      campaignId: id,
      claimer: c.address,
      claimAmount: claimC,
      nonce,
      expiry,
    };
    const txSignature = await getSignature(c, domain, C.claimType, txValues);
    const txSig = {
      nonce,
      expiry,
      v: txSignature.v,
      r: txSignature.r,
      s: txSignature.s,
    };
    const bytes = ethers.encodeBytes32String('blank');
    const delegationSig = {
      nonce: 0,
      expiry: 0,
      v: 0,
      r: bytes,
      s: bytes,
    };
    const tx = await claimContract
      .connect(dao)
      .claimAndDelegateWithSig(id, proof, c.address, claimC, txSig, delegatee, delegationSig);
    expect(tx).to.emit(claimContract, 'Claimed').withArgs(c.address, claimC);
    expect(tx).to.emit(claimContract, 'TokensClaimed').withArgs(id, c.address, claimC, remainder);
    expect(tx).to.emit(token, 'Transfer').withArgs(claimContract.target, lockup.target, claimC);
    let rate = claimC % periods == 0 ? BigInt(claimC / periods) : BigInt(claimC / periods) + BigInt(1);
    expect(tx)
      .to.emit(lockup, 'PlanCreated')
      .withArgs(3, c.address, token.target, claimC, start, cliff, end, rate, period);
    const votingVault = await lockup.votingVaults(3);
    expect(tx).to.emit(lockup, 'VotingVaultCreated').withArgs(3, votingVault);
    expect(await token.delegates(votingVault)).to.eq(delegatee);
    expect(await token.balanceOf(votingVault)).to.eq(claimC);
    expect(await lockup.ownerOf(3)).to.eq(c.address);
  });
  it('DAO claims on behalf of wallet D and delegates to wallet A', async () => {
    remainder = remainder - BigInt(claimD);
    let proof = getProof('./test/trees/tree.json', d.address);
    let delegatee = a.address;
    let expiry = BigInt(await time.latest()) + BigInt(60 * 60 * 24 * 7);
    let nonce = 0;
    const txValues = {
      campaignId: id,
      claimer: d.address,
      claimAmount: claimD,
      nonce,
      expiry,
    };
    const txSignature = await getSignature(d, domain, C.claimType, txValues);
    const txSig = {
      nonce,
      expiry,
      v: txSignature.v,
      r: txSignature.r,
      s: txSignature.s,
    };
    const bytes = ethers.encodeBytes32String('blank');
    const delegationSig = {
      nonce: 0,
      expiry: 0,
      v: 0,
      r: bytes,
      s: bytes,
    };
    const tx = await claimContract
      .connect(dao)
      .claimAndDelegateWithSig(id, proof, d.address, claimD, txSig, delegatee, delegationSig);
    expect(tx).to.emit(claimContract, 'Claimed').withArgs(d.address, claimD);
    expect(tx).to.emit(claimContract, 'TokensClaimed').withArgs(id, d.address, claimD, remainder);
    expect(tx).to.emit(token, 'Transfer').withArgs(claimContract.target, lockup.target, claimD);
    let rate = claimD % periods == 0 ? BigInt(claimD / periods) : BigInt(claimD / periods) + BigInt(1);
    expect(tx)
      .to.emit(lockup, 'PlanCreated')
      .withArgs(4, d.address, token.target, claimD, start, cliff, end, rate, period);
    const votingVault = await lockup.votingVaults(4);
    expect(tx).to.emit(lockup, 'VotingVaultCreated').withArgs(4, votingVault);
    expect(await token.delegates(votingVault)).to.eq(delegatee);
    expect(await token.balanceOf(votingVault)).to.eq(claimD);
    expect(await lockup.ownerOf(4)).to.eq(d.address);
  });
};

const lockedErrorTests = () => {};

module.exports = {
  lockedTests,
  lockedErrorTests,
};

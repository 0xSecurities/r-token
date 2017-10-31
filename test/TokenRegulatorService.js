var helpers = require("./helpers");
var MockRegulatedToken = artifacts.require("../test/helpers/MockRegulatedToken.sol");
var TokenRegulatorService = artifacts.require("./TokenRegulatorService.sol");

const PERM_NONE = 0x0;
const PERM_SEND = 0x1;
const PERM_RECEIVE = 0x2;
const PERM_TRANSFER = PERM_SEND | PERM_RECEIVE;

contract('TokenRegulatorService', async (accounts) => {
  let owner, account, token, service;

  beforeEach(async () => {
    owner = accounts[0];
    admin = accounts[1]
    account = accounts[2];
    other = accounts[3];

    service = await TokenRegulatorService.new({ from: owner });
    token = await MockRegulatedToken.new();
  });

  const onlyOwner = (method, producer) => {
    it(method + ' requires owner permissions', async () => {
      let [service, ...args] = producer();

      let acct = accounts[accounts.length - 1];

      assert.isTrue(!!acct);
      assert.isTrue(acct != accounts[0]);

      await helpers.expectThrow(
        service[method](...args, { from: acct })
      );
    });
  }

  describe('permissions', () => {
    onlyOwner('lock', () => { return [service, token.address] });
    onlyOwner('unlock', () => { return [service, token.address] });
    onlyOwner('allowPartialTransfers', () => { return [service, token.address] });
    onlyOwner('disallowPartialTransfers', () => { return [service, token.address] });
    onlyOwner('setPermission', () => { return [service, token.address, account, 0] });
    onlyOwner('transferAdmin', () => { return [service, account] });

    describe('setPermission', () => {
      beforeEach(async () => {
        await service.transferAdmin(admin);
      });

      it('allows admin to invoke', async () => {
        await service.setPermission.call(0, account, 0, { from: admin });
        await helpers.expectThrow(
          service.setPermission.call(0, account, 0, { from: other })
        );
      });
    });
  });

  describe('locking', () => {
    beforeEach(async () => {
      await service.setPermission(token.address, owner, PERM_TRANSFER);
      await service.setPermission(token.address, account, PERM_TRANSFER);
    });

    it('is locked by default', async () => {
      assert.isFalse(await service.check.call(token.address, owner, account, 0));
    });

    it('toggles the ability to trade', async () => {
      assert.isFalse(await service.check.call(token.address, owner, account, 0));
      await service.unlock(token.address);
      assert.isTrue(await service.check.call(token.address, owner, account, 0));
      await service.lock(token.address);
      assert.isFalse(await service.check.call(token.address, owner, account, 0));
    });
  });

  describe('partial trades', () => {
    beforeEach(async () => {
      await service.unlock(token.address);
      await service.setPermission(token.address, owner, PERM_TRANSFER);
      await service.setPermission(token.address, account, PERM_TRANSFER);

      const decimals = 4,
            expectedTotalSupply = 2000 * 10**decimals;

      await token.setDecimals(decimals);
      await token.mint(owner, expectedTotalSupply);

      assert.equal(expectedTotalSupply, await token.totalSupply.call());

      assert.isFalse(await service.check.call(token.address, owner, account, 10001111));
    });

    describe('when partial trades are allowed', async () => {
      it('allows fractional trades', async () => {
        await service.allowPartialTransfers(token.address);
        assert.isTrue(await service.check.call(token.address, owner, account, 10001111));
        assert.isTrue(await service.check.call(token.address, owner, account, 10000000));
      });
    });

    describe('when partial trades are NOT allowed', async () => {
      it('does NOT allow fractional trades', async () => {
        await service.disallowPartialTransfers(token.address);
        assert.isTrue(await service.check.call(token.address, owner, account, 10000000));
        assert.isFalse(await service.check.call(token.address, owner, account, 10001111));
      });
    });
  });

  describe('permissions', async () => {
    beforeEach(async () => {
      await service.unlock(token.address);
    });

    describe('when granular permissions are used', () => {
      it('requires a sender to have send permissions', async () => {
        await service.setPermission(token.address, owner, PERM_SEND);
        await service.setPermission(token.address, account, PERM_RECEIVE);

        assert.isTrue(await service.check.call(token.address, owner, account, 0));

        await service.setPermission(token.address, owner, PERM_RECEIVE);
        await service.setPermission(token.address, account, PERM_RECEIVE);

        assert.isFalse(await service.check.call(token.address, owner, account, 0));
      });

      it('requires a a receiver to have receive permissions', async () => {
        await service.setPermission(token.address, owner, PERM_SEND);
        await service.setPermission(token.address, account, PERM_RECEIVE);

        assert.isTrue(await service.check.call(token.address, owner, account, 0));

        await service.setPermission(token.address, owner, PERM_RECEIVE);
        await service.setPermission(token.address, account, PERM_SEND);

        assert.isFalse(await service.check.call(token.address, owner, account, 0));
      });
    });

    describe('when a participant does not exist', () => {
      beforeEach(async () => {
        await service.setPermission(token.address, owner, PERM_SEND | PERM_RECEIVE);
        await service.setPermission(token.address, account, PERM_SEND | PERM_RECEIVE);

        assert.isTrue(await service.check.call(token.address, owner, account, 0));
      });

      it('denies trades', async () => {
        assert.isFalse(await service.check.call(token.address, owner, '0x0', 0));
        assert.isFalse(await service.check.call(token.address, '0x0', owner, 0));
      });
    });

    describe('when both participants are eligible', () => {
      beforeEach(async () => {
        await service.setPermission(token.address, owner, PERM_NONE);
        await service.setPermission(token.address, account, PERM_NONE);
        assert.isFalse(await service.check.call(token.address, owner, account, 0));
      });

      it('allows trades', async () => {
        await service.setPermission(token.address, owner, PERM_TRANSFER);
        await service.setPermission(token.address, account, PERM_TRANSFER);

        assert.isTrue(await service.check.call(token.address, owner, account, 0));
      });
    });

    describe('when one participant is ineligible', () => {
      beforeEach(async () => {
        await service.setPermission(token.address, owner, PERM_TRANSFER);
        await service.setPermission(token.address, account, PERM_TRANSFER);
        assert.isTrue(await service.check.call(token.address, owner, account, 0));
      });

      it('prevents trades', async () => {
        await service.setPermission(token.address, owner, PERM_TRANSFER);
        await service.setPermission(token.address, account, PERM_NONE);

        assert.isFalse(await service.check.call(token.address, owner, account, 0));

        await service.setPermission(token.address, owner, PERM_NONE);
        await service.setPermission(token.address, account, PERM_TRANSFER);

        assert.isFalse(await service.check.call(token.address, owner, account, 0));
      });
    });

    describe('when no participants are eligible', () => {
      beforeEach(async () => {
        await service.setPermission(token.address, owner, PERM_TRANSFER);
        await service.setPermission(token.address, account, PERM_TRANSFER);
        assert.isTrue(await service.check.call(token.address, owner, account, 0));
      });

      it('prevents trades', async () => {
        await service.setPermission(token.address, owner, PERM_NONE);
        await service.setPermission(token.address, account, PERM_NONE);

        assert.isFalse(await service.check.call(token.address, owner, account, 0));
      });
    });
  });
});

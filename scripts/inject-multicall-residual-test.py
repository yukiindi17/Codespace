from pathlib import Path

target = Path("relay-settlement/contracts/relay-chain/test/MulticallRouter/MulticallRouter.t.sol")
source = target.read_text()
test_name = "test_crossDepositoryCanSweepPriorBundleResidual"
if test_name in source:
    raise SystemExit("Regression test already injected")
marker = "  function testSettleNativeSweepsFullBalanceAfterMinimum() public {"
if marker not in source:
    raise SystemExit("Expected insertion point missing; refusing to patch")

test = r"""
  function test_crossDepositoryCanSweepPriorBundleResidual() public {
    // Depository A's previous bundle leaves an intermediate ERC20 on the
    // shared router. This simulates an omitted currency in its residual sweep.
    address depositoryB = makeAddr("depositoryB");
    address attacker = makeAddr("attacker");
    vm.prank(admin);
    router.grantRole(depositoryRole, depositoryB);

    tokenA.mintFor(50, address(router));

    // Depository A completes a multicall but fails to sweep tokenA.
    vm.prank(depository);
    router.multicall(new Call[](0));
    assertEq(tokenA.balanceOf(address(router)), 50);

    // Any other DEPOSITORY_ROLE holder can invoke the router's self-only
    // sweep helper from inside its own multicall and redirect the old balance.
    Call[] memory calls = new Call[](1);
    calls[0] = _sweepCall(_currencies(address(tokenA)), attacker);
    vm.prank(depositoryB);
    router.multicall(calls);

    assertEq(tokenA.balanceOf(attacker), 50);
    assertEq(tokenA.balanceOf(address(router)), 0);
  }

"""
target.write_text(source.replace(marker, test + marker, 1))
print(f"Injected {test_name} into {target}")

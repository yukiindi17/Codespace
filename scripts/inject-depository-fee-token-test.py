from pathlib import Path

target = Path("relay-settlement/contracts/depository-evm/test/RelayDepositoryTest.t.sol")
source = target.read_text()
test_name = "test_feeOnTransferDepositEventOverstatesActualReceivedBalance"
if test_name in source:
    raise SystemExit("Regression test already injected")
contract_marker = "contract RelayDepositoryTest is BaseTest, EIP712 {"
test_marker = "  function test_depositErc20(uint96 amount) public {"
if contract_marker not in source or test_marker not in source:
    raise SystemExit("Expected insertion markers missing; refusing to patch")

token = r"""
contract TaxedDepositToken {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  uint256 public totalSupply;

  function mint(address account, uint256 amount) external {
    balanceOf[account] += amount;
    totalSupply += amount;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
  }

  function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    uint256 approved = allowance[from][msg.sender];
    require(approved >= amount, "allowance");
    require(balanceOf[from] >= amount, "balance");
    allowance[from][msg.sender] = approved - amount;
    balanceOf[from] -= amount;
    uint256 fee = amount / 10;
    balanceOf[to] += amount - fee;
    totalSupply -= fee;
    return true;
  }
}

"""
test = r"""
  function test_feeOnTransferDepositEventOverstatesActualReceivedBalance() public {
    TaxedDepositToken taxed = new TaxedDepositToken();
    taxed.mint(alice.addr, 100);

    vm.prank(alice.addr);
    taxed.approve(address(relayDepository), 100);

    vm.expectEmit(true, true, true, true, address(relayDepository));
    emit RelayErc20Deposit(alice.addr, address(taxed), 100, bytes32(uint256(1)));

    vm.prank(alice.addr);
    relayDepository.depositErc20(alice.addr, address(taxed), 100, bytes32(uint256(1)));

    assertEq(taxed.balanceOf(address(relayDepository)), 90);
    assertEq(taxed.totalSupply(), 90);
  }

"""
source = source.replace(contract_marker, token + contract_marker, 1)
source = source.replace(test_marker, test + test_marker, 1)
target.write_text(source)
print(f"Injected {test_name} into {target}")

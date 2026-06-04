export const ERC20_MINIMAL_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address account) view returns (uint256)'
] as const;

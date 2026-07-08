Historical bridge/custom-error handoff. This predates the 10-minute PoC ABI;
current series identity uses `maturityTimestamp`.

Implemented the focused bridge/custom-error changes.

  What changed:

  - ShieldBridge.unshield(...) no longer requires the public series to exist.
  - finalizeUnshield(...) now creates the missing public series clone using the confidential token’s maturityTimestamp, then calls
    bridgeMint.

  - Removed bridgeMintable, fundBridgeReserve, BridgeReserveFunded, and the bridge reserve capacity check from PublicOptionFactory.
  - bridgeMint now only requires the caller to be the configured bridge and the public series to exist.
  - Converted smart-contract errors to <CONTRACT_NAME>__<ERROR>() format across contracts/src, and cleaned Solidity test mocks too.
  - Replaced remaining require(...) / string reverts in Solidity contracts/tests with custom errors.
  - Added/updated tests for:
      - bridge mint without separate reserve capacity
      - unshield finalization creating a missing public series before minting
      - updated custom-error selectors

Implemented shielding in the renamed bridge.

  Changes made:

  - Renamed the earlier UnshieldBridge contract/file to ShieldBridge.
  - Added shield(strikePrice, maturityTimestamp, isStable, amount):
      - burns the public option token from the user
      - creates the confidential series if missing
      - calls confidential factory bridgeMint
      - mints the same amount confidentially to the user

  - Added bridgeMint(...) to confidential OptionFactory.
  - Auto-authorizes the configured bridge on newly created public and confidential series.
  - Updated DeployBridge.s.sol to deploy ShieldBridge.
  - Renamed/updated bridge tests and added shield coverage.

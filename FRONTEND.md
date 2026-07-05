# Freedom Protocol Frontend Build Spec

This is the frontend handoff document. Assume the current `frontend/` directory
may be deleted. A new agent should be able to build the app from scratch using
this file plus `FREEDOM.md`, `BACKEND.md`, and the contracts under
`contracts/src`.

## Product Goal

Build a simple options protocol interface with three main pages:

- `Deposit`
- `Trade`
- `Settle`

Each page has the same top-level mode switch:

- `Public`
- `Confidential`

The user should never feel like they are using two different apps. Public and
Confidential are modes inside the same three workflows.

The core user journey is:

```text
Deposit ETH/WETH/cWETH -> receive P and N option tokens
Trade P or N in the options market
Settle matured P and/or N for ETH/WETH/cWETH collateral
```

## Non-Goals

- Do not build a marketing landing page.
- Do not make separate top-level sections for public and confidential mode.
- Do not make Portfolio, Bridge, Config, or Market Info primary pages. `/shield`
  may be a compact primary utility page when ShieldBridge is configured.
- Do not add bright color themes, gradients, blue DeFi styling, glassmorphism, or
  decorative illustrations.
- Do not hide the important protocol actions behind long educational copy.

Secondary views can exist as modals, drawers, compact panels, or admin-only
routes, but the visible app should be organized around Deposit, Trade, Settle,
with Shield only as a compact bridge utility.

## Mental Model

Freedom creates two complementary option tokens for each `(strike, maturity)`
series:

- `P` token: `stableETH`, the floor/stable side.
- `N` token: `upETH`, the upside side.

Splitting 1 unit of collateral mints exactly:

```text
1 P + 1 N
```

Before maturity, merging exactly `1 P + 1 N` returns exactly 1 unit of
collateral. At maturity, settlement preserves the invariant:

```text
P payout + N payout = 1 collateral
```

Payout formula:

```text
if oraclePrice == 0 or strike >= oraclePrice:
  P payout = 1.0 collateral
  N payout = 0.0 collateral
else:
  P payout = strike / oraclePrice
  N payout = 1 - P payout
```

Contracts use:

```text
SCALE = 1_000_000
token decimals = 6
```

All option token amounts should be displayed with 6 decimals.

## Modes

### Public

Public mode is the default.

Use public mode for normal EVM UX:

- Collateral: ETH or WETH, depending on selected factory/deployment.
- Option tokens: standard ERC-20 P and N tokens.
- Balances: plaintext.
- Trading: normal visible orderbook/DEX-style market.
- Settlement: plaintext claim calculation.
- Network: any deployed EVM network.

### Confidential

Use confidential mode for private position sizing and private trade amounts.

- Collateral: `cWETH`.
- Option tokens: confidential P and N tokens.
- Balances: encrypted.
- Trading: confidential matching/listing flow.
- Settlement: claim cWETH using encrypted balances.
- Network: a deployed Zama fhEVM-compatible chain such as Sepolia.

When the user switches to Confidential, the app should check the connected
network and prompt a network switch if needed. FHE SDK initialization should be
lazy and only happen when confidential functionality is used.

## Visual Direction

The UI should feel like a focused trading terminal, not a marketing site.

### Style

- Theme: minimal dark mode only.
- Palette: shades of black and grey with restrained bumblebee-yellow accents.
- Font: monospace preferred for the entire app.
- Density: compact, readable, and calm.
- Corners: small radius, 4px to 8px.
- Borders: thin grey borders.
- Shadows: minimal or none.
- Layout: simple panels, tables, segmented controls, and forms.

### Suggested Color Tokens

Use a restrained palette similar to:

```css
:root {
  --bg: #050505;
  --panel: #0d0d0d;
  --panel-2: #151515;
  --panel-3: #1f1f1f;
  --border: #2a2a2a;
  --border-strong: #3a3a3a;
  --text: #eeeeee;
  --text-muted: #9a9a9a;
  --text-soft: #6f6f6f;
  --yellow: #f5c84b;
  --yellow-soft: #3a300f;
  --danger: #ff6b6b;
}
```

Yellow is an accent, not the dominant background. Use it for:

- Active nav item indicator.
- Selected segment state.
- Primary action focus ring or underline.
- Small status dots.
- Important numeric highlights.

Avoid blue, purple, teal, green, large gradients, and multicolor decorations.

### Typography

Use a monospace font stack:

```css
font-family:
  "IBM Plex Mono",
  "Geist Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

Guidance:

- Page titles: 20px to 24px.
- Panel headings: 13px to 15px.
- Body text: 13px to 14px.
- Labels and metadata: 11px to 12px.
- Keep letter spacing at `0`.
- Do not use viewport-based font scaling.

### Motion

Add a decent amount of micro-animation, but keep it functional and fast.

Use animations for:

- Page transitions: subtle fade and 4px vertical slide.
- Mode switch: sliding active indicator.
- Form field focus: border and background transition.
- Buttons: slight translate or brightness change on hover/press.
- Transaction stepper: animated progress line or pulsing current step.
- Table rows/cards: hover background transition.
- Balance reveal: encrypted dots resolving into numbers.
- Market updates: brief yellow flash on changed price/amount.
- Toasts: slide/fade in and out.

Timing:

```text
fast: 120ms
normal: 180ms
slow: 260ms
easing: cubic-bezier(0.2, 0.8, 0.2, 1)
```

Respect `prefers-reduced-motion`; disable non-essential motion when requested.

## App Shell

### Routes

Primary navigation routes:

```text
/deposit
/trade
/shield
/settle
```

`/` should redirect to `/deposit`.

Optional internal routes may exist for debugging or admin tasks, but they must
not appear as primary nav:

```text
/config
/admin
```

### Layout

Desktop:

```text
top bar
  left: Freedom
  center: Deposit | Trade | Settle
  right: mode switch | network | wallet

main content
  centered max width, usually 960px to 1120px
```

Mobile:

```text
top bar
  Freedom | wallet button

bottom nav
  Deposit | Trade | Settle

mode switch
  inside page header
```

Do not use a large sidebar for the primary app. The product has only three main
pages, so top or bottom navigation is simpler.

### Global Header

Header contents:

- `Freedom` wordmark.
- Primary nav links: `Deposit`, `Trade`, `Settle`.
- Public/Confidential segmented switch.
- Network status.
- Connect wallet button or connected account pill.

Header behavior:

- Active nav uses a yellow underline or left tick.
- Wallet button opens wallet connect modal.
- Network status is compact; warn only when action is blocked.
- Mode switch persists in local storage.

## Shared Components

### Mode Switch

Every page should expose the same `Public | Confidential` switch.

Behavior:

- Public is default.
- Persist selected mode in local storage.
- Switching to Confidential checks chain support.
- If unsupported, show a compact blocking panel with action to switch network.
- Do not navigate to different public/confidential page sets.

### Series Selector

Used on all three pages.

Fields:

- Strike price.
- Maturity.
- Token side when needed: `P`, `N`, or both.

Display:

- Current oracle ETH price.
- Time to maturity or maturity status.
- Series status: `Not created`, `Active`, `Matured`, `Settled`.
- P/N token addresses behind copy buttons or compact details.

Strike and maturity should be quick to choose. Use segmented presets or compact
selects, not a large wizard.

### Amount Input

Used in Deposit, Trade, and Settle.

Requirements:

- Numeric input with token symbol.
- Balance line.
- `Max` button.
- Validation for insufficient balance, missing allowance, unsupported network,
  invalid amount, and action-specific series state. Trade must not reject sells
  solely because maturity has passed.
- Consistent 6-decimal formatting for P/N and cWETH protocol amounts.

### Transaction Stepper

Any multi-transaction flow should use a compact stepper.

Examples:

- Approve WETH.
- Create series.
- Deposit/split.
- Create listing.
- Fill listing.
- Settle series.
- Redeem.

Each step has:

- Idle, pending signature, submitted, confirmed, failed states.
- Hash link when available.
- Retry failed step when safe.

### Empty States

Empty states should be short and actionable.

Examples:

```text
No active positions
Deposit collateral to mint P and N.

No orders
Create the first listing for this series.

Nothing to settle
Your active series have not matured yet.
```

Do not add long protocol essays inside empty states.

## Page 1: Deposit

Purpose:

```text
User chooses Public or Confidential, selects strike and maturity, deposits
collateral, and receives equal P + N tokens.
```

### Public Deposit

User can deposit:

- ETH, if a native public factory is deployed.
- WETH, if a WETH public factory is deployed.

If both are available, show a compact collateral segmented control:

```text
ETH | WETH
```

Primary form:

```text
Deposit

Mode: Public | Confidential
Collateral: ETH | WETH
Amount: [             ] [Max]
Strike: [select]
Maturity: [select]

You receive:
P stableETH-[strike]-[maturity]    [amount]
N upETH-[strike]-[maturity]        [amount]

[Deposit]
```

Public transaction flow:

```text
1. Validate strikePrice as a positive multiple of 50.
2. Use the selected 10-minute `maturityTimestamp`.
3. Read factory registry for the selected series.
4. If series exists:
   use returned P/N token addresses.
5. If series does not exist:
   show predicted P/N token addresses.
6. If collateral is native ETH:
   PublicOptionFactory.createSeriesAndSplit(..., { value: amount })
   or split(...) for already-created series.
7. If collateral is WETH/ERC20:
   collateral.approve(factory.vault(), amount), when needed.
   PublicOptionFactory.createSeriesAndSplit(...) or split(...).
```

After success:

- Show minted P and N amounts.
- Show links/actions: `Trade`, `Settle later`, `Copy token addresses`.
- Refresh balances.

### Confidential Deposit

User deposits `cWETH`.

The current bridge contract is `ShieldBridge`. If `/shield` is enabled, keep it
compact and client-only. If the user lacks cWETH, include a compact inline cWETH
acquisition panel inside Deposit.

Confidential primary form:

```text
Deposit

Mode: Public | Confidential
Collateral: cWETH
cWETH balance: encrypted [Reveal]
Amount: [             ] [Max]
Strike: [select]
Maturity: [select]

You receive:
Confidential P stableETH-[strike]-[maturity]
Confidential N upETH-[strike]-[maturity]
Amounts remain encrypted on-chain.

[Deposit cWETH]
```

Confidential flow:

```text
1. Ensure user is on the configured confidential deployment chain, e.g. Sepolia.
2. Initialize FHE SDK lazily.
3. Authorize factory.vault() on cWETH.
   - allowance mode: encrypt allowance for cWETHAddress + userAddress and call
     cWETH.approve(vault, encAllowance, allowanceProof).
   - operator mode: call the ERC7984-style operator authorization, e.g.
     setOperator(vault, until).
4. Encrypt deposit amount for factoryAddress + userAddress.
5. If selected series does not exist:
   submit OptionFactory.createSeriesAndSplit(strikePrice, maturityTimestamp,
   encAmt, proof).
6. If selected series exists:
   submit OptionFactory.split(strikePrice, maturityTimestamp, encAmt, proof).
```

The same `externalEuint64/proof` must not be reused for cWETH transfer. The
factory consumes the external input once and the contracts pass internal
encrypted handles to the vault/cWETH.

cWETH acquisition panel:

```text
Need cWETH?
[Wrap ETH to WETH] -> [Shield WETH to cWETH]
```

This can be a drawer or inline collapsible panel. It must not become a fourth
main page.

## Page 2: Trade

Purpose:

```text
User buys or sells P and/or N options for a selected strike and maturity.
```

Trade is the options market page. It should prioritize market interaction, not
portfolio management.

### Shared Trade Layout

Suggested desktop layout:

```text
left panel: order ticket
right panel: market/order list
bottom panel: user's open orders and balances
```

Suggested mobile layout:

```text
series selector
tabs: Buy | Sell | Orders
order ticket
market list
```

Shared controls:

- Mode switch.
- Series selector.
- Token side: `P stableETH` or `N upETH`.
- Optional market filter: `All`, `Live`, `Settled`; default `All`.
- Buy/Sell selector.
- Amount.
- Limit price or expected receive, depending on backend support.
- Balance and allowance state.

Market state rules:

- Do not hide matured or settled series from Trade by default.
- `Live` means not settled yet. It can temporarily include matured but
  unsettled series while keeper settlement is pending.
- `Settled` means factory settlement emitted and payout ratios are fixed.
- Do not expose a separate `Matured` market tab/filter.
- A matured unsettled series should appear under `Live` with a small
  `settlement pending` status and a path to Settle.
- A settled series should show fixed P and N payout info so buyers understand
  what they are buying.
- Users may sell matured or settled P/N tokens when they have balance and the
  token contract/listing backend allows it.
- Do not disable Sell solely because maturity has passed. Disable only for no
  balance, token interaction failure, invalid listing terms, or backend listing
  lifecycle states such as cancelled, filled, or explicitly expired.

### Public Trade

Public trading is visible and standard.

Supported implementation options:

- Use backend-provided orderbook endpoints, if available.
- Use DEX/router integration, if deployed.
- Provide direct token transfer or copy-token-address fallback only as a last
  resort, not as the primary UX.

Public order ticket:

```text
Trade

Mode: Public | Confidential
Series: [strike] [maturity]
Side: P | N
Action: Buy | Sell
Amount: [          ] [Max]
Price:  [          ]

Estimated receive:
Fees:
Price impact or spread:

[Place order] or [Swap]
```

Public market display:

- Bids and asks.
- Last price.
- Available liquidity.
- User balances for selected P and N.
- Series state: `Live`, `Matured, settlement pending`, or `Settled`.
- Fixed P/N payout details for settled series.
- Token addresses in compact detail menu.

Public flow:

```text
1. Select series and token side.
2. Read market data.
3. Validate balance and allowance.
4. Approve token/router/matching contract if needed.
5. Submit order/swap transaction.
6. Show confirmation and refresh market.
```

### Confidential Trade

Confidential trading uses encrypted amounts and encrypted minimum receive /
expected receive values.

Publicly visible:

- Series.
- Token side.
- Quote token.
- Listing id.
- Active/cancelled state.

Encrypted:

- Listed amount.
- Minimum acceptable receive.
- Buyer payment.
- Buyer expected token amount.

Confidential order ticket:

```text
Trade

Mode: Public | Confidential
Series: [strike] [maturity]
Side: P | N
Action: Create listing | Fill listing
Quote: cWETH / cUSDC / cDAI

Amount: [          ]
Minimum receive: [          ]

Values are encrypted before submission.

[Create private listing]
```

Confidential listing flow:

```text
1. Select confidential series and token side.
2. Choose quote token.
3. Enter amount and minimum receive.
4. Encrypt amount for matching engine.
5. Encrypt minimum receive for matching engine.
6. Submit ConfidentialMatchingEngine.createListing(...).
```

Confidential fill flow:

```text
1. Select active listing.
2. Enter encrypted payment amount.
3. Enter encrypted expected token amount.
4. Submit ConfidentialMatchingEngine.fill(...).
5. Contract verifies the match privately.
```

Confidential market display:

- Active listings by series and side.
- Listing id.
- Token side.
- Quote token.
- Seller address truncated.
- Amount hidden unless owned and revealed by user.
- User's open listings.
- Cancel listing action for seller.

## Page 3: Settle

Purpose:

```text
User claims ETH/WETH/cWETH against matured P and/or N tokens.
```

Settle should answer one question clearly:

```text
What can I claim now?
```

### Shared Settle Layout

Show positions grouped by status:

- `Claimable`: matured and settled positions with user balance.
- `Needs settlement`: matured but oracle settlement not posted.
- `Active`: not matured yet.

Each position row/card:

```text
Series: [strike] [maturity]
Mode: Public or Confidential
Holdings: P and/or N
Status: Active / Matured / Settled
Claimable: [amount collateral]
[Claim]
```

Keep settlement math available in a compact expandable details row:

```text
Oracle price:
P payout:
N payout:
1 P + 1 N = 1 collateral
```

### Public Settle

Public settlement uses plaintext balances.

Claim behavior:

- User can claim against P, N, or both if they hold both.
- If the contract `redeem` function burns the user's full balance for the
  series, make that explicit before transaction submission.
- Show estimated ETH/WETH payout before the user signs.

Public flow:

```text
1. Query created series.
2. Read P and N token addresses.
3. Read user's P and N balances.
4. Check maturity and settlement state.
5. For settled series, calculate estimated claim from payout rates.
6. Submit PublicOptionFactory.redeem(strikePrice, maturityTimestamp).
```

Chainlink adapter settlement:

- For matured unsettled series, show `Settle series` when an oracle adapter is
  configured.
- Read `latestEthUsdPrice()` from the adapter and show ETH/USD plus the
  Chainlink update timestamp.
- Public mode calls `settlePublic(publicFactory, strikePrice, maturityTimestamp)`.
- Confidential mode calls
  `settleConfidential(confidentialFactory, strikePrice, maturityTimestamp)`.
- Do not expose a manual oracle price input for normal users.
- Do not call factory `settle(strikePrice, maturityTimestamp, oraclePrice)` from the
  frontend UI.

### Confidential Settle

Confidential settlement uses encrypted balances.

Confidential UI requirements:

- Balances default to hidden.
- User can reveal their own balance through the FHE user-decryption flow.
- Claim estimates may be hidden until reveal is complete.
- The claim transaction should not expose more than the protocol requires.

Confidential flow:

```text
1. Ensure user is on the configured confidential deployment chain, e.g. Sepolia.
2. Query confidential series.
3. Read encrypted P and N balance handles.
4. Allow user to reveal local display balances.
5. For settled series, estimate claim locally after reveal when possible.
6. Submit OptionFactory.redeem(strikePrice, maturityTimestamp).
7. User receives cWETH.
```

ShieldBridge supports moving option tokens between public and confidential
forms:

```text
Public -> Confidential:
  shield(strikePrice, maturityTimestamp, isStable, amount)

Confidential -> Public:
  unshield(strikePrice, maturityTimestamp, isStable, amount)
  finalizeUnshield(requestId, abiEncodedCleartexts, decryptionProof)
```

The frontend must not fake `finalizeUnshield`; show pending finalization until
the backend keeper observes the request, public-decrypts the burned amount
handle, and submits finalization.

## Data And Backend Integration

Prefer the backend API described in `BACKEND.md` for:

- Deployment registry.
- Supported chains.
- Public and confidential factory addresses.
- Series list.
- Market/order data.
- Transaction builder endpoints, if implemented.
- Indexed user positions, if implemented.

The frontend may call contracts directly with `viem` for reads when backend data
is unavailable, but should keep the data layer abstracted so a backend indexer
can replace direct event scanning.

Recommended data hooks:

```text
useDeployments()
useSelectedMode()
useSeriesList(mode)
useSeries(strike, maturity, mode)
useBalances(user, mode)
useDepositFlow(mode)
useMarket(mode, series)
useTradeFlow(mode)
useSettlement(mode, user)
useFhe()
```

## Contract References

Public contracts:

- `contracts/src/public/PublicOptionFactory.sol`
- `contracts/src/public/PublicOptionToken.sol`
- `contracts/src/public/CentralCollateralVault.sol`

Confidential contracts:

- `contracts/src/confidential/OptionFactory.sol`
- `contracts/src/confidential/OptionToken.sol`
- `contracts/src/confidential/ConfidentialCollateralVault.sol`
- `contracts/src/confidential/ConfidentialMatchingEngine.sol`
- `contracts/src/confidential/ConfidentialERC20Base.sol`

Bridge:

- `contracts/src/bridge/ShieldBridge.sol`

Sepolia defaults:

- Public WETH: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- Zama Sepolia cWETHMock: `0x46208622DA27d91db4f0393733C8BA082ed83158`
- WETH wraps Sepolia ETH through `deposit()` payable; it is not a faucet mint.
- cWETH mint/faucet behavior depends on the verified Zama wrapper/mock token ABI.
- Public factory bridge reserve capacity/funding UI is obsolete; `fundBridgeReserve`,
  `bridgeMintable`, and `BridgeReserveFunded` are removed.
- Optional bridge keeper status API: `FREEDOM_MARKET_API_URL`.
- ShieldBridge keeper status is read with `GET /bridges/requests`; the
  frontend does not submit clear amounts, decrypt proofs, signatures, handles,
  or plaintext balances to the backend.

Shared interfaces/base:

- `contracts/src/base/OptionFactoryBase.sol`
- `contracts/src/base/OptionTokenBase.sol`
- `contracts/src/interfaces/IOptionFactory.sol`
- `contracts/src/interfaces/IOptionToken.sol`

## Formatting And Units

Rules:

- P/N token decimals: 6.
- `SCALE = 1_000_000`.
- Strike and oracle price must use matching units.
- Display ETH/WETH/cWETH with sensible precision, usually 6 decimals in
  protocol forms.
- Display USD-like prices with 2 decimals when used as market guidance.
- Never silently round transaction input values in a way that changes submitted
  amounts.

Labels:

- Use `P stableETH` and `N upETH` consistently.
- Use `Public` and `Confidential` consistently.
- Use `Deposit`, `Trade`, `Settle`, and `Shield` as the main nav labels.

## Wallet And Network UX

Wallet states:

- Disconnected.
- Connected wrong network.
- Connected supported public network.
- Connected configured confidential network for confidential mode.

Rules:

- Read-only market and series data can be visible while disconnected.
- Transaction buttons require wallet connection.
- Confidential actions require fhEVM.
- Avoid full-page blocking unless no deployment data is available.
- Show precise blocking reason near the disabled action.

### Sepolia Runtime Config

The frontend can be configured from build/Vercel env or runtime `/env.js`.

```text
FREEDOM_SEPOLIA_PUBLIC_ETH_FACTORY=
FREEDOM_SEPOLIA_PUBLIC_WETH_FACTORY=
FREEDOM_SEPOLIA_WETH_TOKEN=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14

FREEDOM_SEPOLIA_CONFIDENTIAL_FACTORY=
FREEDOM_SEPOLIA_CWETH_TOKEN=0x46208622DA27d91db4f0393733C8BA082ed83158
FREEDOM_SEPOLIA_CWETH_AUTH_MODE=operator # allowance | operator | none
FREEDOM_SEPOLIA_CWETH_OPERATOR_UNTIL=      # optional unix timestamp

FREEDOM_ANVIL_SHIELD_BRIDGE=
FREEDOM_SEPOLIA_SHIELD_BRIDGE=
FREEDOM_ANVIL_ORACLE_ADAPTER=
FREEDOM_SEPOLIA_ORACLE_ADAPTER=

FREEDOM_ZAMA_GATEWAY_CHAIN_ID=10901
FREEDOM_ZAMA_RELAYER_URL=https://relayer.testnet.zama.org
```

cWETH auth modes:

- `allowance`: encrypt allowance for `cWETHAddress + userAddress`, then call
  `approve(factory.vault(), encAllowance, proof)`.
- `operator`: call the ERC7984-style operator method, e.g.
  `setOperator(factory.vault(), until)`.
- `none`: dev/testing only.

Confidential balance reveal should use `confidentialBalanceOf(address)` for the
encrypted handle where available, request a wallet EIP-712 user-decrypt
signature, and keep plaintext balances only in memory. Do not show fake
decrypted balances.

Example button labels:

```text
Connect wallet
Switch network
Enter amount
Approve WETH
Create series
Deposit
Create listing
Fill listing
Claim
```

## Error Handling

Errors should be short, local to the failed action, and useful.

Examples:

```text
Insufficient WETH balance.
Approve WETH before depositing.
This series has already matured.
This series has not been settled yet.
Confidential mode requires the configured confidential network.
Encryption failed. Try again.
Transaction rejected in wallet.
```

Do not dump raw RPC errors unless the user opens a technical details disclosure.

## Accessibility

Minimum requirements:

- Keyboard navigable nav, forms, dialogs, and tables.
- Visible focus states using grey/yellow styling.
- Sufficient contrast on dark backgrounds.
- No information conveyed only by color.
- Reduced motion support.
- Form inputs have labels.
- Buttons have clear disabled states and reasons.

## Suggested Tech Stack

Recommended:

- Next.js App Router.
- React.
- TypeScript.
- Tailwind CSS or plain CSS modules.
- `wagmi` and `viem`.
- `@tanstack/react-query` for async server/contract state.
- Zustand only for lightweight UI preferences like selected mode.
- FHE SDK lazy-loaded for confidential mode.

Do not overbuild global state. Most data should come from query hooks and be
invalidated after transactions.

## Implementation Checklist

The finished frontend should have:

- `/` redirects to `/deposit`.
- `/deposit`, `/trade`, `/shield`, and `/settle` primary pages.
- A dark greyscale shell with yellow accent states.
- Monospace typography.
- Public/Confidential mode switch on every primary page.
- Public deposit for ETH/WETH into P + N.
- Confidential deposit for cWETH into confidential P + N.
- Trade page for public market and confidential listings.
- Settle page for claiming against P and/or N after maturity.
- Compact wallet and network handling.
- Transaction stepper for multi-step flows.
- Empty, loading, pending, success, and error states.
- Micro-animations for mode switch, page transitions, forms, tables, tx states,
  balance reveal, and market updates.
- Reduced-motion support.
- No primary pages other than Deposit, Trade, Shield, and Settle.

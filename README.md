# Folio — Strategy Lab

A free browser-based options strategy playground with an original visual design. Build a position, explore its risk, and save it for later. The public app and sample mode have no subscription or Folio account requirement.

**Actual market prices require your own Upstox account and free personal Analytics Token.** The default workspace starts disconnected and shows unavailable prices, rather than substituting sample quotes. Sample mode remains available without a broker account. An anonymous free live-data feed has not been verified or provided.

## Run locally

On this Mac, double-click **start.command**, or run `./start.command` from the project folder. The launcher finds either a standard Node installation or the Node runtime bundled with Codex.

With Node.js 20 or newer:

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). There are no package dependencies to install.

Alternatively, with Python 3 installed, serve the same project folder:

```sh
python3 -m http.server 5173 --bind 127.0.0.1
```

Keep the terminal running while using the app. ES modules require an HTTP server; opening `index.html` directly from the filesystem is insufficient.

## What you can do

- Build multiple buy/sell call and put legs, choosing strikes, expiries, premiums, IV, and lot quantities. Enable or disable individual legs to compare structures.
- Connect a personal feed for provider-reported NIFTY, BANKNIFTY, and SENSEX index prices, option contracts, expiries, lot sizes, LTP, IV, and open interest where available. Add a listed contract from the option chain to your strategy.
- Start from ten presets: bull call, bull put, bear put, bear call, long call, long put, iron condor, call butterfly, long straddle, and long strangle.
- Compare expiry payoff with theoretical scenario P&L while changing the underlying price, elapsed days, and implied volatility.
- Compare fixed entry premium, market LTP, model target value, market P&L, and model P&L under **P&L table → Option values**.
- Inspect maximum profit, maximum loss, breakevens, net debit/credit, reward/risk, model probability of profit, and option Greeks. Unlimited call upside or loss is identified explicitly.
- Save named positions in the browser, reopen them later, and export or import JSON backups.

Live strike dropdowns contain the exact listed contracts returned for the selected index, expiry, and option type. The chain shows up to 25 strikes near spot. An explicitly selected missing strike is rejected rather than silently replaced. Presets may be unavailable when their required strikes have no listed contract or usable quote. Sample mode offers 61 illustrative strike choices around its sample spot.

Saved positions use `localStorage`. They persist across refreshes in the same browser profile and site origin. Private browsing, clearing site data, changing browsers, or switching between `localhost` and `127.0.0.1` can produce a separate or empty collection. Export JSON backups to keep a portable copy. Positions are not synced to an account or cloud service.

Entry premiums and unit quantities remain fixed when quotes or current contract lot sizes change. Editing a contract captures a new hypothetical entry; it changes the saved copy only when you save again. Each saved leg retains its own lot size and quantity. Version 1 records migrate using their original illustrative lot sizes—NIFTY 65, BANKNIFTY 30, and SENSEX 20—rather than current exchange metadata. Version 2 JSON backups preserve contract identity, quantities, provenance, and supported valuation metadata, while imports still accept version 1 backups.

## Connect actual market data

1. Create or sign in to an Upstox account yourself. Account registration and any verification happen on Upstox, outside this app.
2. Follow the [official Upstox Analytics Token guide](https://upstox.com/developer/api-documentation/analytics-token/): open [Developer Apps](https://account.upstox.com/developer/apps), choose **Analytics**, generate a token, and copy it. Upstox documents this token as free and read-only.
3. Choose **Connect market data** in Folio and paste your personal Analytics Token. Connecting opens a fresh market workspace; your saved positions remain in the library.

The browser makes authenticated GET requests directly to `api.upstox.com`. The token stays in memory for that tab and is lost when the page refreshes. It is never written to the repository, browser storage, position backups, or a shared server. Do not commit or share a token. The app does not place orders or redistribute a shared account's market feed.

While the connected tab is visible, the app attempts to refresh prices every 30 seconds. Successful access still depends on Upstox, your token, account permissions, network availability, and browser CORS support. Disconnecting or refreshing the page requires connecting again.

## Market P&L and quote status

Market mark-to-market P&L uses provider LTP: signed saved quantity × (current LTP − entry premium). It is separate from the theoretical Black–Scholes scenarios. LTP is a last traded price, not a guaranteed executable price or a bid/ask liquidation value.

The feed snapshot timestamp and the option's actual last-trade timestamp are distinct. During open or unknown sessions, marks older than 90 seconds are unavailable; when an actual trade timestamp is supplied, it must also satisfy that freshness limit. A missing trade timestamp is not invented from the request receipt time. Closed-market views explicitly show last quoted prices and retain their timestamps.

Missing, stale, invalid, and expired unresolved quotes stay unavailable rather than becoming zero or model prices. A genuine quoted zero remains zero. If any enabled leg lacks a usable mark, the strategy's full market P&L is unavailable. The engine can return a partial subtotal, but it is not displayed as a complete strategy total.

Expired positions need an official settlement value before their market P&L can be resolved. The engine and saved format support an optional per-option `settlementPrice`, which fixes settled P&L and removes ongoing Greek exposure. There is no settlement-value editor in the current interface.

## Data and pricing assumptions

Market mode passes an explicit current valuation clock to the pricing engine. Quote freshness is checked against the actual current time, independently of the model's valuation baseline. Model outputs require usable index data and IV assumptions; unavailable market inputs are not replaced with sample values.

The separate **Sample mode** uses an illustrative snapshot dated **26 October 2026 at 12:00 IST**. Its prices, changes, open interest, IV, lot sizes, and expiry dates are synthetic examples, not current exchange contract specifications. The engine retains `DEMO_DATE` as its default for backward compatibility and deterministic tests; market callers pass their valuation time explicitly. Expiry valuation uses 15:30 IST on the selected date unless an explicit contract expiry timestamp is supplied.

The pricing engine uses European Black–Scholes with zero dividends, constant IV for each modeled scenario, and a default continuously compounded annual risk-free rate of **6%**, adjustable in calculation settings. It assumes 365 calendar days per year. It does not include early exercise, transaction fees, brokerage, taxes, bid/ask spread, slippage, funding costs, or exchange margin requirements. All reported P&L excludes these costs.

Expiry P&L is intrinsic value less entry premium, multiplied by the saved signed unit quantity. Scenario P&L replaces intrinsic value with the modeled option value at the selected future time; already settled legs retain fixed cash P&L. Changing IV shifts each enabled leg's stored IV by the same number of percentage points. IV can come from the provider, calibration to a quoted premium, or manual input; unavailable IV is identified explicitly. Model prices and Greeks can differ from traded premiums, and changing quotes does not change a saved entry premium.

For positions with a shared expiry, the engine computes breakevens and payoff limits across the full nonnegative underlying-price range, including the unlimited call tail. For mixed expiries, it evaluates the position at the nearest expiry, using intrinsic value for expiring legs and theoretical time value for later legs. Those mixed-expiry limits and breakevens use numerical analysis, rather than representing the final payoff of every leg at a single common expiry.

Probability of profit (POP) uses a risk-neutral lognormal terminal-price distribution with the selected IV and rate, measured at the analysis expiry. It is a model estimate, not a forecast or the historical probability of a successful trade. The profit test excludes fees. A position with exactly zero payoff is not counted as profitable.

The Greeks shown for a strategy aggregate signed contract quantities:

| Greek | Convention |
| --- | --- |
| Delta | P&L sensitivity to a one-point underlying move |
| Gamma | Change in strategy delta per underlying point |
| Theta | P&L sensitivity to one calendar day passing |
| Vega | P&L sensitivity to one percentage-point IV increase |
| Rho | P&L sensitivity to a one percentage-point annual-rate increase; available in the engine |

The public `optionPrice` and `optionGreeks` functions accept decimal volatility and interest rates, such as `0.142` and `0.06`. Leg `iv` values and scenario IV shifts use percentages, such as `14.2` and `2`.

For background, see the Options Industry Council's [Black–Scholes explanation](https://www.optionseducation.org/advancedconcepts/black-scholes-formula) and [guide to understanding options Greeks](https://www.optionseducation.org/advancedconcepts/understanding-options-greeks). These describe theoretical pricing inputs and the limits of sensitivity estimates. The implementation is original; reference material is linked for learning.

## Verify

```sh
npm test
npm run check
```

The tests use Node's built-in runner and mocked provider responses. They cover pricing parity, numerical Greek checks, exact payoff limits and roots, mixed expiries, immutable quantities, LTP versus modeled P&L, stale/missing quotes, settlement, real-contract selection, provider normalization and errors, source switching, storage migration, and backup validation.

**Authenticated end-to-end verification still requires a real personal token.** Mocked API tests and sample-mode checks do not prove that a visitor's account can retrieve the real feed from the published site.

## Project structure

```text
index.html            Browser entry point
server.mjs            Local static development server
src/app.js            Interface, interactions, saved positions, and backups
src/styles.css        Responsive visual design
src/data.js           Separate sample/live state, contracts, chains, and presets
src/market-data.js    Personal read-only Upstox browser adapter
src/engine.js         Option models, calibration, quantity handling, and LTP MTM
src/storage.js        Validated browser persistence and JSON backups
tests/engine.test.mjs  Calculation tests
tests/storage.test.mjs Persistence and backup validation tests
tests/data.test.mjs    Source separation and contract-selection tests
tests/market-data.test.mjs Mocked provider and failure-path tests
start.command         Mac launcher with automatic Node runtime discovery
```

## Public hosting

The project is prepared for GitHub Pages at [trying-ai.github.io/market-lab](https://trying-ai.github.io/market-lab/), with source in [Trying-AI/market-lab](https://github.com/Trying-AI/market-lab). Publish the root of the `main` branch under **Settings → Pages → Deploy from a branch**. The `.nojekyll` file serves the app as plain static files; no build or paid hosting service is required.

Localhost and the public website have separate browser storage. To move saved positions to the public website, export a JSON backup from localhost, then import it through **My positions** on the hosted site. Saved positions are never part of the repository and are not shared with other visitors.

The public site uses the same static app as localhost: market mode requires each visitor's personal Upstox connection, while sample mode is explicitly labeled. There is no shared token, anonymous live-feed service, or automatic broker-account signup. Folio accounts and cloud storage for cross-device position access remain future work.

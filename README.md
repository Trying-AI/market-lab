# Folio — Strategy Lab

A free options strategy playground with an original visual design. This first local release lets you build a position, explore its risk, and save it for later. It runs entirely in your browser and needs no account or paid subscription.

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
- Explore NIFTY, BANKNIFTY, and SENSEX with a synthetic option chain. Add a contract from the chain to your strategy.
- Start from ten presets: bull call, bull put, bear put, bear call, long call, long put, iron condor, call butterfly, long straddle, and long strangle.
- Compare expiry payoff with theoretical scenario P&L while changing the underlying price, elapsed days, and implied volatility.
- See each option's modeled target premium, change from entry, and contribution to net P&L under **P&L table → Option values**.
- Inspect maximum profit, maximum loss, breakevens, net debit/credit, reward/risk, model probability of profit, and option Greeks. Unlimited call upside or loss is identified explicitly.
- Save named positions in the browser, reopen them later, and export or import JSON backups.

Saved positions use `localStorage`. They persist across refreshes in the same browser profile and site origin. Private browsing, clearing site data, changing browsers, or switching between `localhost` and `127.0.0.1` can produce a separate or empty collection. Export JSON backups to keep a portable copy. Positions are not synced to an account or cloud service.

## Data and pricing assumptions

The app uses an illustrative snapshot dated **26 October 2026 at 12:00 IST**, rather than the computer's current time. Prices, percentage changes, open interest, implied volatility, lot sizes, and offered expiry dates are synthetic examples. They are not a live exchange feed or a source of current contract specifications. Expiry valuation assumes 15:30 IST on the selected date.

The pricing engine uses European Black–Scholes with zero dividends, constant implied volatility for each modeled scenario, and a continuously compounded annual risk-free rate of **6%**. It assumes 365 calendar days per year. It does not include early exercise, transaction fees, brokerage, taxes, bid/ask spread, slippage, funding costs, or exchange margin requirements. All reported P&L excludes these costs.

Expiry P&L is intrinsic value less the entered entry premium, multiplied by signed lots and lot size. Scenario P&L replaces intrinsic value with the modeled option value at the selected future time. Changing IV shifts each enabled leg's IV by the same number of percentage points. Modeled scenarios can differ from traded market premiums.

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

The tests use Node's built-in test runner and cover known option prices, put-call parity, Greeks against numerical sensitivities, exact payoff bounds and roots, unlimited risk, scenario time/IV changes, contract quantities, disabled legs, and mixed expiries.

## Project structure

```text
index.html            Browser entry point
server.mjs            Local static development server
src/app.js            Interface, interactions, saved positions, and backups
src/styles.css        Responsive visual design
src/data.js           Illustrative markets, chains, and presets
src/engine.js         Dependency-free option calculations
src/storage.js        Validated browser persistence and JSON backups
tests/engine.test.mjs  Calculation tests
tests/storage.test.mjs Persistence and backup validation tests
start.command         Mac launcher with automatic Node runtime discovery
```

## Public hosting

The project is prepared for GitHub Pages at [trying-ai.github.io/market-lab](https://trying-ai.github.io/market-lab/), with source in [Trying-AI/market-lab](https://github.com/Trying-AI/market-lab). Publish the root of the `main` branch under **Settings → Pages → Deploy from a branch**. The `.nojekyll` file serves the app as plain static files; no build or paid hosting service is required.

Localhost and the public website have separate browser storage. To move saved positions to the public website, export a JSON backup from localhost, then import it through **My positions** on the hosted site. Saved positions are never part of the repository and are not shared with other visitors.

A production live-data connection, current exchange contract metadata, user accounts, and cloud storage for cross-device position access remain future work. The public version continues to use clearly labeled illustrative data.

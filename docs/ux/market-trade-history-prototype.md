# Market trade history prototype

Place a trade history table directly below the chart in the left workspace column. Keep the buy and milestone controls in the right column. The table shows every curve `Trade` event, newest first, with Date, Type, USD, market token symbol, Price, Trader, and Txn columns. Buy is green and Sell is red. Keep a single "Trade history" heading. Align numeric values with their headers. USD uses the current ETH/USD rate, and Price is the effective fill per token.

On desktop, stretch the history panel to the bottom of the Milestone panel. Keep rows at a readable height and anchor pagination at the panel bottom. A long page of history scrolls inside the panel.

On narrow screens, stack chart, history, and controls. Let the table scroll horizontally so amounts and links remain readable. Paginate 25 rows at a time with a visible range and Previous/Next controls. Show a short loading, empty, or error message in the history area. Resolve a trader's verified primary `.rise` name through the existing identity endpoint; show the shortened address when no name resolves.

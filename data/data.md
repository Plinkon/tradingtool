where the data is

script used to fetch data:
```python
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta

# Helper function to subtract days
def subtract_days(date_str: str, days: int) -> str:
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    new_date = date_obj - timedelta(days=days)
    return new_date.strftime("%Y-%m-%d")

# Define tickers and parameters
tickers = [
    "NVDA", "AAPL", "MSFT", "GOOGL", "GOOG",
    "AMZN", "META", "AVGO", "TSLA", "BRK.B",
    "LLY", "JPM", "V", "WMT", "NFLX",
    "XOM", "MA", "HD", "PG", "JNJ",
    "UNH", "NVDA", "CRM", "DIS", "BAC",
    "PYPL", "ADBE", "INTC", "CSCO", "CMCSA",
    "ORCL", "T", "VZ", "KO", "PFE",
    "COST", "PEP", "NKE", "ABBV", "MCD",
    "WFC", "ACN", "TXN", "AVY", "MDT",
    "C", "QCOM", "SAP", "BMY", "LIN",
    "AMGN", "PM", "UPS", "MS", "GS",
    "BLK", "RTX", "HON", "CAT", "CVX",
    "DE", "IBM", "GE", "LMT", "AXP",
    "BDX", "SYK", "GILD", "ISRG", "MO",
    "SPGI", "PLD", "EL", "ADP", "BKNG",
    "CI", "MDLZ", "MMM", "DUK", "SO",
    "TGT", "FDX", "ZTS", "AON", "MMC",
    "CB", "AEP", "NEE", "EOG", "SLB",
    "PSX", "COP", "HUM", "REGN", "MAR",
    "SBUX", "GM", "F", "DAL", "UAL",
    "CSX", "NSC", "ADSK", "TEAM", "NOW",
    "SNOW", "PANW", "NET", "CRWD", "DDOG",
    "SHOP", "SQ", "ROKU", "TWLO", "UBER",
    "LYFT", "ABNB", "DKNG", "ROBL", "PLTR",
    "VWAGY", "SONY", "TM", "HMC", "BP",
    "TOT", "BHP", "RIO", "NEM", "VALE",
    "SPOT", "EA", "TTWO", "ATVI", "CHWY",
    "RBLX", "COIN", "HOOD", "ETSY", "DOCU",
    "ZM", "BABA", "JD", "PDD", "TCEHY"
]

current_date = '2025-11-13'
iterations = 1

for ticker in tickers:
    for i in range(iterations):
        # Compute date ranges
        start_offset = (i + 1) * 8
        end_offset = i * 8

        end_date = subtract_days(current_date, end_offset)
        start_date = subtract_days(current_date, start_offset)

        print(f"\nDownloading {ticker} data from {start_date} to {end_date}")

        # Fetch the data
        data = yf.download(ticker, start=start_date, end=end_date, interval='1m')

        # Save to CSV
        csv_filename = f"{ticker}.csv"
        data.to_csv(csv_filename)

        print(f"Saved {ticker} iteration {i+1} data to {csv_filename}")

```

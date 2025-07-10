import os
import ccxt
import pandas as pd
import numpy as np
from datetime import datetime
import time
import warnings
import json
import sys
import logging
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from sklearn.preprocessing import MinMaxScaler
import matplotlib.pyplot as plt
from multiprocessing import Pool
import requests

# Configurer le logging à ERROR pour éviter les logs INFO sur stderr en production
logging.basicConfig(level=logging.ERROR, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

warnings.filterwarnings("ignore")

# Configuration des exchanges (Kraken + Binance pour fallback et arbitrage)
exchanges = {
    'kraken': ccxt.kraken({'enableRateLimit': True}),
    'binance': ccxt.binance({'enableRateLimit': True})
}

# Ajouter API keys si disponibles (pour extensions privées)
for ex_name, ex in exchanges.items():
    api_key = os.getenv(f'{ex_name.upper()}_API_KEY')
    secret = os.getenv(f'{ex_name.upper()}_SECRET')
    if api_key and secret:
        ex.apiKey = api_key
        ex.secret = secret

# Liste étendue de paires USD/USDT sur Kraken
pairs = sorted([
    '1INCH/USD', 'AAVE/USD', 'ACH/USD', 'ADA/USD', 'AGLD/USD', 'AIR/USD', 'AKT/USD', 'ALCX/USD', 'ALGO/USD', 'ALICE/USD',
    'ALPHA/USD', 'ANKR/USD', 'ANT/USD', 'APE/USD', 'API3/USD', 'APT/USD', 'ARB/USD', 'ASTR/USD', 'ATLAS/USD', 'ATOM/USD',
    'AUDIO/USD', 'AVAX/USD', 'AXS/USD', 'BADGER/USD', 'BAL/USD', 'BAND/USD', 'BASE/USD', 'BAT/USD', 'BCH/USD', 'BICO/USD',
    'BIGTIME/USD', 'BIT/USD', 'BLUR/USD', 'BLZ/USD', 'BNC/USD', 'BNT/USD', 'BOBA/USD', 'BOME/USD', 'BONK/USD', 'BOSON/USD',
    'BRICK/USD', 'BTC/USD', 'C98/USD', 'CAT/USD', 'CFG/USD', 'CHR/USD', 'CHZ/USD', 'COMP/USD', 'COTI/USD', 'CRV/USD',
    'CSM/USD', 'CTSI/USD', 'CVX/USD', 'DAI/USD', 'DASH/USD', 'DOGE/USD', 'DOT/USD', 'DPI/USD', 'DYDX/USD', 'DYM/USD',
    'EGLD/USD', 'ENA/USD', 'ENJ/USD', 'ENS/USD', 'EOS/USD', 'ETC/USD', 'ETH/USD', 'EUL/USD', 'EURT/USD', 'EWT/USD',
    'FARM/USD', 'FET/USD', 'FIDA/USD', 'FIL/USD', 'FIS/USD', 'FLOW/USD', 'FLR/USD', 'FORTH/USD', 'FTM/USD', 'FXS/USD',
    'GALA/USD', 'GAL/USD', 'GARI/USD', 'GHST/USD', 'GLMR/USD', 'GMT/USD', 'GNO/USD', 'GRT/USD', 'GST/USD', 'GTC/USD',
    'HDRO/USD', 'HNT/USD', 'ICP/USD', 'ICX/USD', 'IDEX/USD', 'ILV/USD', 'IMX/USD', 'INJ/USD', 'JASMY/USD', 'JTO/USD',
    'JUP/USD', 'KAR/USD', 'KAVA/USD', 'KEEP/USD', 'KILT/USD', 'KIN/USD', 'KINT/USD', 'KNC/USD', 'KP3R/USD', 'KSM/USD',
    'LDO/USD', 'LINK/USD', 'LPT/USD', 'LRC/USD', 'LSK/USD', 'LTC/USD', 'LUNA2/USD', 'MANA/USD', 'MASK/USD', 'MATIC/USD',
    'MC/USD', 'MINA/USD', 'MKR/USD', 'MLN/USD', 'MNDE/USD', 'MOVR/USD', 'MSOL/USD', 'MULTI/USD', 'MV/USD', 'MXC/USD',
    'NANO/USD', 'NEAR/USD', 'NKN/USD', 'NMR/USD', 'NODL/USD', 'NOS/USD', 'NYM/USD', 'OCEAN/USD', 'OGN/USD', 'OMN/USD',
    'OP/USD', 'ORCA/USD', 'OXT/USD', 'PARA/USD', 'PAXG/USD', 'PEPE/USD', 'PERP/USD', 'PHA/USD', 'PLA/USD', 'POLIS/USD',
    'POL/USD', 'POND/USD', 'POWR/USD', 'PSTAKE/USD', 'PYUSD/USD', 'QNT/USD', 'QTUM/USD', 'RAD/USD', 'RARE/USD', 'RARI/USD',
    'RAY/USD', 'RBC/USD', 'REN/USD', 'REP/USD', 'REQ/USD', 'RLY/USD', 'RNDR/USD', 'ROOK/USD', 'RPL/USD', 'SAND/USD',
    'SBR/USD', 'SC/USD', 'SCRT/USD', 'SDN/USD', 'SEI/USD', 'SGB/USD', 'SHIB/USD', 'SNX/USD', 'SOL/USD', 'SPELL/USD',
    'SRM/USD', 'STEP/USD', 'STORJ/USD', 'STG/USD', 'STRK/USD', 'SUI/USD', 'SUPER/USD', 'SUSHI/USD', 'SYN/USD', 'TBTC/USD',
    'TEER/USD', 'TIA/USD', 'TLM/USD', 'TOKE/USD', 'TRAC/USD', 'TRIBE/USD', 'TRU/USD', 'TRX/USD', 'TVK/USD', 'UMA/USD',
    'UNFI/USD', 'UNI/USD', 'USDC/USD', 'USDT/USD', 'UST/USD', 'WAVES/USD', 'WAXL/USD', 'WBTC/USD', 'WIF/USD', 'WOO/USD',
    'XCN/USD', 'XLM/USD', 'XMR/USD', 'XRP/USD', 'XRT/USD', 'XTZ/USD', 'YFI/USD', 'YGG/USD', 'ZEC/USD', 'ZEN/USD',
    'ZEUS/USD', 'ZKS/USD', 'ZRX/USD', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT', 'AVAX/USDT', 'DOT/USDT',
    'LINK/USDT', 'MATIC/USDT', 'LTC/USDT', 'BCH/USDT', 'USDC/USDT'
])

# Paramètres (rendus plus dynamiques pour optimisation)
TIMEFRAMES = ['1h', '4h', '1d']
LIMIT = 1000  # Augmenté pour backtesting et ML
BB_PERIOD = 20
BB_STD = 2.0
RSI_PERIOD = 14
EMA_FAST = 12
EMA_SLOW = 26
MACD_SIGNAL = 9
ATR_PERIOD = 14
MOMENTUM_PERIOD = 10
STOCH_PERIOD = 14
LEVERAGE = 50
TARGET_MOVE = 0.02
MIN_ATR_MULTIPLIER = 2.0
FEE_RATE = 0.001  # Estimation des frais
SLIPPAGE = 0.0005  # Estimation du slippage
RISK_PER_TRADE = 0.01  # Risque max par trade (% du capital)
CORR_THRESHOLD = 0.8  # Seuil de corrélation pour diversification

# Dict for CoinGecko IDs for sentiment
symbol_to_id = {
    'BTC': 'bitcoin', 'ETH': 'ethereum', 'XRP': 'ripple', 'SOL': 'solana', 'DOGE': 'dogecoin', 'ADA': 'cardano',
    'SUI': 'sui', 'AAVE': 'aave', 'LINK': 'chainlink', 'AVAX': 'avalanche-2', 'NEAR': 'near-protocol', 'XLM': 'stellar',
    'LTC': 'litecoin', 'DOT': 'polkadot', 'MATIC': 'polygon', 'UNI': 'uniswap', 'BCH': 'bitcoin-cash', 'TRX': 'tron',
    'USDT': 'tether', 'USDC': 'usd-coin', 'DAI': 'dai', 'SHIB': 'shiba-inu', 'PEPE': 'pepe', 'FET': 'fetch-ai',
    'INJ': 'injective-protocol', 'APT': 'aptos', 'ARB': 'arbitrum', 'OP': 'optimism', 'FIL': 'filecoin', 'ATOM': 'cosmos',
    'ICP': 'internet-computer', 'RNDR': 'render-token', 'IMX': 'immutable-x', 'HBAR': 'hedera-hashgraph', 'KAS': 'kaspa',
    'STX': 'stacks', 'MNT': 'mantle', 'CRO': 'crypto-com-chain', 'VET': 'vechain', 'FDUSD': 'first-digital-usd',
    'MKR': 'maker', 'GRT': 'the-graph', 'BGB': 'bitget-token', 'FLOKI': 'floki-inu', 'THETA': 'theta-network',
    'BSV': 'bitcoin-sv', 'LDO': 'lido-dao', 'BTT': 'bittorrent', 'JASMY': 'jasmycoin', 'ONDO': 'ondo-finance',
    'EGLD': 'elrond-erd-2', 'CORE': 'coredaoorg', 'RUNE': 'thorchain', 'PYTH': 'pyth-network', 'BRETT': 'based-brett',
    'FTT': 'ftx-token', 'NOT': 'notcoin', 'TIA': 'celestia', 'ALGO': 'algorand', 'QNT': 'quant-network', 'SEI': 'sei-network',
    'FLR': 'flare-networks', 'FLOW': 'flow', 'OM': 'mantra-dao', 'KCS': 'kucoin-shares', 'EOS': 'eos', 'BEAM': 'beam',
    'AXS': 'axie-infinity', 'GALA': 'gala', 'BTT': 'bittorrent', 'DYDX': 'dydx', 'EGLD': 'multiversx', 'NEO': 'neo',
    'XTZ': 'tezos', 'USDD': 'usdd', 'SAND': 'the-sandbox', 'AKT': 'akash-network', 'CFX': 'conflux-token', 'WLD': 'worldcoin-wld',
    'ECO': 'echelon-prime', 'RON': 'ronin', 'GT': 'gatechain-token', 'BOME': 'book-of-meme', 'MANA': 'decentraland'
}  # Extended for more

# Classe pour dataset LSTM
class CryptoDataset(Dataset):
    def __init__(self, data, seq_length):
        self.data = data
        self.seq_length = seq_length

    def __len__(self):
        return len(self.data) - self.seq_length

    def __getitem__(self, idx):
        return (
            torch.tensor(self.data[idx:idx+self.seq_length], dtype=torch.float32),
            torch.tensor(self.data[idx+self.seq_length], dtype=torch.float32)
        )

# Modèle LSTM pour prédiction de prix
class LSTMModel(nn.Module):
    def __init__(self, input_size=1, hidden_size=50, num_layers=1):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.linear = nn.Linear(hidden_size, 1)

    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        return self.linear(lstm_out[:, -1, :])

# Entraînement LSTM (simple et rapide)
def train_lstm(df, epochs=5, seq_length=50, batch_size=32):
    if len(df) < seq_length + 1:
        return None, None

    scaler = MinMaxScaler()
    scaled_data = scaler.fit_transform(df['close'].values.reshape(-1, 1))

    dataset = CryptoDataset(scaled_data, seq_length)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    model = LSTMModel()
    criterion = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

    model.train()
    for epoch in range(epochs):
        for x, y in dataloader:
            optimizer.zero_grad()
            output = model(x)
            loss = criterion(output, y)
            loss.backward()
            optimizer.step()

    return model, scaler

# Prédiction avec LSTM
def predict_price(model, scaler, last_sequence):
    model.eval()
    with torch.no_grad():
        input_tensor = torch.tensor(last_sequence, dtype=torch.float32).unsqueeze(0)
        pred = model(input_tensor).item()
    return scaler.inverse_transform([[pred]])[0][0]

# Fetch OHLCV avec fallback multi-exchange
def fetch_ohlcv(pair, timeframe, limit, preferred_exchange='kraken'):
    ex = exchanges.get(preferred_exchange)
    try:
        return ex.fetch_ohlcv(pair, timeframe, limit=limit)
    except Exception as e:
        logger.error(f"Erreur sur {preferred_exchange}: {e}. Tentative sur l'autre exchange.")
        alt_ex_name = 'binance' if preferred_exchange == 'kraken' else 'kraken'
        alt_ex = exchanges[alt_ex_name]
        try:
            return alt_ex.fetch_ohlcv(pair, timeframe, limit=limit)
        except Exception as alt_e:
            logger.error(f"Erreur sur {alt_ex_name}: {alt_e}.")
            return []

# Calcul des indicateurs (amélioré avec Stochastic, Volume EMA, supports/résistances plus robustes)
def calculate_indicators(df):
    if df.empty or len(df) < max(BB_PERIOD, RSI_PERIOD, EMA_SLOW, MOMENTUM_PERIOD, STOCH_PERIOD):
        return None

    try:
        df['sma'] = df['close'].rolling(window=BB_PERIOD).mean()
        df['std'] = df['close'].rolling(window=BB_PERIOD).std()
        df['upper_bb'] = df['sma'] + BB_STD * df['std']
        df['lower_bb'] = df['sma'] - BB_STD * df['std']

        delta = df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=RSI_PERIOD).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=RSI_PERIOD).mean()
        rs = gain / loss.replace(0, np.nan)
        df['rsi'] = 100 - (100 / (1 + rs))

        df['ema_fast'] = df['close'].ewm(span=EMA_FAST, adjust=False).mean()
        df['ema_slow'] = df['close'].ewm(span=EMA_SLOW, adjust=False).mean()

        df['macd'] = df['ema_fast'] - df['ema_slow']
        df['macd_signal'] = df['macd'].ewm(span=MACD_SIGNAL, adjust=False).mean()

        df['tr'] = np.maximum(
            df['high'] - df['low'],
            np.maximum(
                abs(df['high'] - df['close'].shift()),
                abs(df['low'] - df['close'].shift())
            )
        )
        df['atr'] = df['tr'].rolling(window=ATR_PERIOD).mean()

        df['momentum'] = df['close'] - df['close'].shift(MOMENTUM_PERIOD)

        high = df['high'].rolling(window=50).max()
        low = df['low'].rolling(window=50).min()
        diff = high - low
        df['fib_0.236'] = high - 0.236 * diff
        df['fib_0.382'] = high - 0.382 * diff
        df['fib_0.5'] = high - 0.5 * diff
        df['fib_0.618'] = high - 0.618 * diff
        df['fib_0.764'] = high - 0.764 * diff

        # Supports et résistances
        supports = []
        resistances = []
        current_price = df['close'].iloc[-1]
        for i in range(2, len(df) - 2):
            if df['low'].iloc[i] < df['low'].iloc[i-1] and df['low'].iloc[i] < df['low'].iloc[i+1] and df['low'].iloc[i] < current_price:
                supports.append(df['low'].iloc[i])
            if df['high'].iloc[i] > df['high'].iloc[i-1] and df['high'].iloc[i] > df['high'].iloc[i+1] and df['high'].iloc[i] > current_price:
                resistances.append(df['high'].iloc[i])

        support = min(supports, default=np.nan, key=lambda x: abs(x - current_price)) if supports else np.nan
        resistance = min(resistances, default=np.nan, key=lambda x: abs(x - current_price)) if resistances else np.nan

        if not np.isnan(support) and not np.isnan(resistance) and abs(support - resistance) < current_price * 0.001:
            support = np.nan if resistance < current_price else support
            resistance = np.nan if support > current_price else resistance

        df['support'] = [support] * len(df)
        df['resistance'] = [resistance] * len(df)

        # Stochastic Oscillator
        low_min = df['low'].rolling(window=STOCH_PERIOD).min()
        high_max = df['high'].rolling(window=STOCH_PERIOD).max()
        df['stoch_k'] = 100 * (df['close'] - low_min) / (high_max - low_min)
        df['stoch_d'] = df['stoch_k'].rolling(window=3).mean()

        # Volume EMA for breakout detection
        df['volume_ema'] = df['volume'].ewm(span=20, adjust=False).mean()

        return df
    except Exception as e:
        logger.error(f"Erreur dans calculate_indicators: {e}")
        return None

# Get sentiment using Fear and Greed Index
def get_sentiment(pair):
    try:
        response = requests.get('https://api.alternative.me/fng/')
        response.raise_for_status()
        data = response.json()
        value = int(data['data'][0]['value'])
        return (value - 50) / 50.0  # -1 to 1, general for crypto market
    except Exception as e:
        logger.error(f"Erreur dans get_sentiment: {e}")
        return 0

# Get news impact using CoinGecko sentiment votes
def get_news_impact(pair):
    base = pair.split('/')[0]
    if base in symbol_to_id:
        id = symbol_to_id[base]
        try:
            response = requests.get(f'https://api.coingecko.com/api/v3/coins/{id}')
            response.raise_for_status()
            data = response.json()
            sentiment_up = data.get('sentiment_votes_up_percentage', 50)
            return (sentiment_up - 50) / 50.0 * 10  # Scaled to +10/-10
        except Exception as e:
            logger.error(f"Erreur dans get_news_impact for {pair}: {e}")
    return 0

# Calcul du score (amélioré avec ML, sentiment, news, stochastic, volume)
def calculate_score(last_row, signal_type, higher_timeframes=None, ml_prediction=None, sentiment=0, news_impact=0):
    if higher_timeframes is None:
        higher_timeframes = []

    score = 0
    price = last_row['close']

    try:
        rsi = last_row['rsi']
        if not np.isnan(rsi):
            if signal_type == 'ACHAT':
                if rsi < 30:
                    score += 15
                elif rsi < 35:
                    score += 8
            else:
                if rsi > 70:
                    score += 15
                elif rsi > 65:
                    score += 8

        if not np.isnan(last_row['lower_bb']) and not np.isnan(last_row['upper_bb']):
            if signal_type == 'ACHAT':
                if price <= last_row['lower_bb']:
                    score += 15
                elif price <= last_row['sma']:
                    score += 8
            else:
                if price >= last_row['upper_bb']:
                    score += 15
                elif price >= last_row['sma']:
                    score += 8

        if not np.isnan(last_row['ema_fast']) and not np.isnan(last_row['ema_slow']):
            if signal_type == 'ACHAT':
                if last_row['ema_fast'] > last_row['ema_slow']:
                    score += 15
                elif last_row['ema_fast'] >= last_row['ema_slow'] * 0.995:
                    score += 8
            else:
                if last_row['ema_fast'] < last_row['ema_slow']:
                    score += 15
                elif last_row['ema_fast'] <= last_row['ema_slow'] * 1.005:
                    score += 8

        fib_levels = ['fib_0.236', 'fib_0.382', 'fib_0.5', 'fib_0.618', 'fib_0.764']
        fib_proximities = [abs(price - last_row[level]) / price for level in fib_levels if not np.isnan(last_row[level])]
        fib_proximity = min(fib_proximities, default=np.inf)
        if fib_proximity < 0.02:
            score += 15
        elif fib_proximity < 0.05:
            score += 8

        atr = last_row['atr']
        if not np.isnan(atr):
            if atr > last_row['close'] * 0.01:
                score += 15
            elif atr > last_row['close'] * 0.005:
                score += 8

        if signal_type == 'ACHAT' and not np.isnan(last_row['support']):
            if abs(price - last_row['support']) / price < 0.01:
                score += 15
        elif signal_type == 'VENTE' and not np.isnan(last_row['resistance']):
            if abs(price - last_row['resistance']) / price < 0.01:
                score += 15

        if not np.isnan(last_row['macd']) and not np.isnan(last_row['macd_signal']):
            if signal_type == 'ACHAT' and last_row['macd'] > last_row['macd_signal']:
                score += 10
            elif signal_type == 'VENTE' and last_row['macd'] < last_row['macd_signal']:
                score += 10
            elif signal_type == 'ACHAT' and last_row['macd'] > 0:
                score += 5
            elif signal_type == 'VENTE' and last_row['macd'] < 0:
                score += 5

        if not np.isnan(last_row['momentum']):
            if signal_type == 'ACHAT' and last_row['momentum'] > 0:
                score += 5
            elif signal_type == 'VENTE' and last_row['momentum'] < 0:
                score += 5

        confirmation_count = 0
        for tf_data in higher_timeframes:
            if signal_type == 'ACHAT' and tf_data['rsi'] < 35 and tf_data['ema_fast'] > tf_data['ema_slow'] and tf_data['macd'] > tf_data['macd_signal']:
                confirmation_count += 1
            elif signal_type == 'VENTE' and tf_data['rsi'] > 65 and tf_data['ema_fast'] < tf_data['ema_slow'] and tf_data['macd'] < tf_data['macd_signal']:
                confirmation_count += 1
        if confirmation_count >= 2:
            score += 10

        # Ajouts: Stochastic et Volume
        if not np.isnan(last_row['stoch_k']) and not np.isnan(last_row['stoch_d']):
            if signal_type == 'ACHAT' and last_row['stoch_k'] < 20 and last_row['stoch_k'] > last_row['stoch_d']:
                score += 10
            elif signal_type == 'VENTE' and last_row['stoch_k'] > 80 and last_row['stoch_k'] < last_row['stoch_d']:
                score += 10

        if not np.isnan(last_row['volume_ema']) and last_row['volume'] > last_row['volume_ema'] * 1.5:
            score += 5  # Volume breakout

        # ML prediction bonus
        if ml_prediction is not None:
            pred_diff = (ml_prediction - price) / price
            if signal_type == 'ACHAT' and pred_diff > 0.01:
                score += 20 * min(pred_diff / 0.05, 1)
            elif signal_type == 'VENTE' and pred_diff < -0.01:
                score += 20 * min(abs(pred_diff) / 0.05, 1)

        # Sentiment et news
        score += sentiment * 10
        score += news_impact

        return min(max(score, 0), 100)
    except Exception as e:
        logger.error(f"Erreur dans calculate_score: {e}")
        return 0

# Générer des signaux (assouplis pour générer plus souvent)
def generate_signals(df_1h, df_4h, df_1d, pair):
    if df_1h is None or df_4h is None or df_1d is None:
        return [], {'pair': pair, 'score': 0}
    
    signals = []
    last_row_1h = df_1h.iloc[-1]
    last_row_1d = df_1d.iloc[-1]
    price = last_row_1h['close']
    
    # ML prediction
    model, scaler = train_lstm(df_1h)
    ml_pred = None
    if model and scaler:
        last_seq = scaler.transform(df_1h['close'].tail(50).values.reshape(-1, 1))
        if len(last_seq) == 50:
            ml_pred = predict_price(model, scaler, last_seq)
    
    sentiment = get_sentiment(pair)
    news_impact = get_news_impact(pair)
    
    fib_levels_buy = ['fib_0.618', 'fib_0.5', 'fib_0.764']
    fib_levels_sell = ['fib_0.236', 'fib_0.382', 'fib_0.5']
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in fib_levels_buy 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in fib_levels_sell 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    # Assouplir strict: RSI <35 au lieu de <30, fib <0.03, support <0.02
    buy_strict = (
        (price <= last_row_1h['lower_bb']) and
        (last_row_1h['rsi'] < 35) and
        (last_row_1h['ema_fast'] > last_row_1h['ema_slow']) and
        (last_row_1h['macd'] > last_row_1h['macd_signal']) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.03) and
        (not np.isnan(last_row_1d['support']) and abs(price - last_row_1d['support']) / price < 0.02) and
        (last_row_1h['stoch_k'] < 30) and
        (last_row_1h['volume'] > last_row_1h['volume_ema'])
    )
    sell_strict = (
        (price >= last_row_1h['upper_bb']) and
        (last_row_1h['rsi'] > 65) and
        (last_row_1h['ema_fast'] < last_row_1h['ema_slow']) and
        (last_row_1h['macd'] < last_row_1h['macd_signal']) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.03) and
        (not np.isnan(last_row_1d['resistance']) and abs(price - last_row_1d['resistance']) / price < 0.02) and
        (last_row_1h['stoch_k'] > 70) and
        (last_row_1h['volume'] > last_row_1h['volume_ema'])
    )
    
    # Medium: RSI <40, fib <0.06
    buy_medium = (
        (price <= last_row_1h['sma']) and
        (last_row_1h['rsi'] < 40) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.995) and
        (last_row_1h['macd'] > 0) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.06) and
        (last_row_1h['stoch_k'] < 50) and
        (last_row_1h['volume'] > last_row_1h['volume_ema'] * 1.2)
    )
    sell_medium = (
        (price >= last_row_1h['sma']) and
        (last_row_1h['rsi'] > 60) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.005) and
        (last_row_1h['macd'] < 0) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.06) and
        (last_row_1h['stoch_k'] > 50) and
        (last_row_1h['volume'] > last_row_1h['volume_ema'] * 1.2)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
    target_buy = price * (1 + TARGET_MOVE) - price * (FEE_RATE + SLIPPAGE)
    target_sell = price * (1 - TARGET_MOVE) + price * (FEE_RATE + SLIPPAGE)
    stop_loss_buy = price - atr
    stop_loss_sell = price + atr
    
    if not np.isnan(last_row_1d['support']) and abs(target_buy - last_row_1d['support']) / price < 0.005:
        target_buy = last_row_1d['support'] * 0.98
    if not np.isnan(last_row_1d['resistance']) and abs(target_sell - last_row_1d['resistance']) / price < 0.005:
        target_sell = last_row_1d['resistance'] * 1.02
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    signal_data = {
        'pair': pair,
        'price': round(price, 2),
        'target': None,
        'stop_loss': None,
        'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
        'atr': round(atr, 2) if not np.isnan(atr) else None,
        'support': round(last_row_1d['support'], 2) if not np.isnan(last_row_1d['support']) else None,
        'resistance': round(last_row_1d['resistance'], 2) if not np.isnan(last_row_1d['resistance']) else None,
        'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
        'stoch_k': round(last_row_1h['stoch_k'], 2) if not np.isnan(last_row_1h['stoch_k']) else None,
        'confidence': None,
        'reason': None,
        'score': 0,
        'ml_prediction': round(ml_pred, 2) if ml_pred else None,
        'sentiment': round(sentiment, 2),
        'news_impact': round(news_impact, 2),
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }
    
    if buy_strict:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger bas, RSI < 35, EMA haussier, MACD haussier, Momentum positif, Fibonacci + support 1d, confirmé 4h/1d, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
    if sell_strict:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger haut, RSI > 65, EMA baissier, MACD baissier, Momentum négatif, Fibonacci + résistance 1d, confirmé 4h/1d, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
    if buy_medium:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sous SMA, RSI < 40, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, partiellement confirmé 4h/1d, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
    if sell_medium:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            **signal_data,
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sur SMA, RSI > 60, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, partiellement confirmé 4h/1d, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
    
    # Ajout d'un niveau low si score >40 et pas de signal (basé sur EMA trend et momentum)
    if not signals:
        score = calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes, ml_pred, sentiment, news_impact)
        if score > 40:
            signal_type = 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE'
            target = target_buy if signal_type == 'ACHAT' else target_sell
            stop_loss = stop_loss_buy if signal_type == 'ACHAT' else stop_loss_sell
            signals.append({
                **signal_data,
                'signal': signal_type,
                'target': round(target, 2),
                'stop_loss': round(stop_loss, 2),
                'confidence': 'Faible',
                'reason': 'Conditions faibles (basé sur score global, EMA trend, et momentum, avec ML, sentiment et news)',
                'score': round(score, 1)
            })
    
    return signals, {
        **signal_data,
        'score': round(calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes, ml_pred, sentiment, news_impact), 1),
        'ema_trend': last_row_1h['ema_fast'] > last_row_1h['ema_slow'],
        'macd': round(last_row_1h['macd'], 2) if not np.isnan(last_row_1h['macd']) else None,
        'macd_signal': round(last_row_1h['macd_signal'], 2) if not np.isnan(last_row_1h['macd_signal']) else None,
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }

# Analyser un trade soumis
def analyze_trade(pair, entry_price, signal_type, df_1h, df_4h, df_1d):
    if df_1h is None or df_4h is None or df_1d is None:
        return {'type': 'error', 'message': 'Données insuffisantes pour l’analyse'}
    
    try:
        last_row_1h = df_1h.iloc[-1]
        last_row_1d = df_1d.iloc[-1]
        current_price = last_row_1h['close']
        atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
        atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
        
        # ML prediction for analysis
        model, scaler = train_lstm(df_1h)
        ml_pred = None
        if model and scaler:
            last_seq = scaler.transform(df_1h['close'].tail(50).values.reshape(-1, 1))
            if len(last_seq) == 50:
                ml_pred = predict_price(model, scaler, last_seq)
        
        sentiment = get_sentiment(pair)
        news_impact = get_news_impact(pair)
        
        higher_timeframes = [
            {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
             'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
             'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
            {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
             'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
             'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
        ]
        higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
        
        score = calculate_score(last_row_1h, signal_type, higher_timeframes, ml_pred, sentiment, news_impact)
        
        recommendation = 'Indécis'
        reason = []
        
        if signal_type == 'ACHAT':
            if not np.isnan(last_row_1d['support']) and abs(current_price - last_row_1d['support']) / current_price < 0.01:
                score += 10
                reason.append('Prix proche d’un support journalier solide')
            if last_row_1h['ema_fast'] > last_row_1h['ema_slow'] and last_row_1h['macd'] > last_row_1h['macd_signal']:
                score += 10
                reason.append('Tendance haussière confirmée (EMA et MACD)')
            if last_row_1h['rsi'] < 40:
                score += 5
                reason.append('RSI indique une zone de survente')
            if ml_pred and (ml_pred - current_price) / current_price > 0.01:
                score += 10
                reason.append('Prédiction ML haussière')
            stop_loss = entry_price - atr
            if current_price < stop_loss:
                recommendation = 'Vendre'
                reason.append('Prix sous le stop-loss recommandé')
            elif current_price > entry_price * 1.02:
                recommendation = 'Garder'
                reason.append('Prix au-dessus du seuil de profit (2%)')
            elif score > 70:
                recommendation = 'Garder'
                reason.append('Conditions techniques favorables')
            else:
                recommendation = 'Modifier'
                reason.append('Conditions mitigées, envisager d’ajuster le stop-loss')
        else:  # VENTE
            if not np.isnan(last_row_1d['resistance']) and abs(current_price - last_row_1d['resistance']) / current_price < 0.01:
                score += 10
                reason.append('Prix proche d’une résistance journalière solide')
            if last_row_1h['ema_fast'] < last_row_1h['ema_slow'] and last_row_1h['macd'] < last_row_1h['macd_signal']:
                score += 10
                reason.append('Tendance baissière confirmée (EMA et MACD)')
            if last_row_1h['rsi'] > 60:
                score += 5
                reason.append('RSI indique une zone de surachat')
            if ml_pred and (ml_pred - current_price) / current_price < -0.01:
                score += 10
                reason.append('Prédiction ML baissière')
            stop_loss = entry_price + atr
            if current_price > stop_loss:
                recommendation = 'Acheter (couvrir)'
                reason.append('Prix au-dessus du stop-loss recommandé')
            elif current_price < entry_price * 0.98:
                recommendation = 'Garder'
                reason.append('Prix en dessous du seuil de profit (2%)')
            elif score > 70:
                recommendation = 'Garder'
                reason.append('Conditions techniques favorables')
            else:
                recommendation = 'Modifier'
                reason.append('Conditions mitigées, envisager d’ajuster le stop-loss')
        
        return {
            'type': 'trade_analysis',
            'result': {
                'recommendation': recommendation,
                'reason': '; '.join(reason),
                'score': round(min(score, 100), 1),
                'current_price': round(current_price, 2),
                'support': round(last_row_1d['support'], 2) if not np.isnan(last_row_1d['support']) else None,
                'resistance': round(last_row_1d['resistance'], 2) if not np.isnan(last_row_1d['resistance']) else None,
                'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
                'atr': round(atr, 2) if not np.isnan(atr) else None,
                'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
                'ml_prediction': round(ml_pred, 2) if ml_pred else None,
                'sentiment': round(sentiment, 2),
                'news_impact': round(news_impact, 2),
                'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
            }
        }
    except Exception as e:
        logger.error(f"Erreur lors de l’analyse du trade: {e}")
        return {'type': 'error', 'message': f'Erreur lors de l’analyse du trade: {str(e)}'}

# Forcer un trade (assoupli: score >50 au lieu de >60)
def force_trade(fallback_data):
    if not fallback_data:
        return None
    
    valid_fallbacks = [(f, df1, df2, df3) for f, df1, df2, df3 in fallback_data if df1 is not None and df2 is not None and df3 is not None]
    if not valid_fallbacks:
        return None
    
    valid_fallbacks = [
        (f, df1, df2, df3) for f, df1, df2, df3 in valid_fallbacks
        if f['score'] > 50 and not np.isnan(df3.iloc[-1]['support']) and not np.isnan(df3.iloc[-1]['resistance'])
        and abs(df3.iloc[-1]['support'] - df3.iloc[-1]['resistance']) / f['price'] > 0.005  # Assoupli >0.005
    ]
    if not valid_fallbacks:
        return None
    
    best_fallback = max(valid_fallbacks, key=lambda x: x[0]['score'])
    pair = best_fallback[0]['pair']
    df_1h, df_4h, df_1d = best_fallback[1], best_fallback[2], best_fallback[3]
    
    last_row_1h = df_1h.iloc[-1]
    last_row_1d = df_1d.iloc[-1]
    price = last_row_1h['close']
    
    # ML prediction for force
    model, scaler = train_lstm(df_1h)
    ml_pred = None
    if model and scaler:
        last_seq = scaler.transform(df_1h['close'].tail(50).values.reshape(-1, 1))
        if len(last_seq) == 50:
            ml_pred = predict_price(model, scaler, last_seq)
    
    sentiment = get_sentiment(pair)
    news_impact = get_news_impact(pair)
    
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in ['fib_0.618', 'fib_0.5', 'fib_0.764'] 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in ['fib_0.236', 'fib_0.382', 'fib_0.5'] 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    # Assouplir forced: RSI <45, fib <0.15, support <0.03
    buy_forced = (
        (price <= last_row_1h['sma'] * 1.05) and
        (last_row_1h['rsi'] < 45) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.99) and
        (last_row_1h['macd'] >= 0) and
        (last_row_1h['momentum'] > 0) and
        (fib_proximity_buy < 0.15) and
        (not np.isnan(last_row_1d['support']) and abs(price - last_row_1d['support']) / price < 0.03) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.004) and
        (last_row_1h['stoch_k'] < 40)
    )
    sell_forced = (
        (price >= last_row_1h['sma'] * 0.95) and
        (last_row_1h['rsi'] > 55) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.01) and
        (last_row_1h['macd'] <= 0) and
        (last_row_1h['momentum'] < 0) and
        (fib_proximity_sell < 0.15) and
        (not np.isnan(last_row_1d['resistance']) and abs(price - last_row_1d['resistance']) / price < 0.03) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.004) and
        (last_row_1h['stoch_k'] > 60)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    atr = max(atr, last_row_1h['close'] * 0.005) * MIN_ATR_MULTIPLIER
    target_buy = price * (1 + TARGET_MOVE) - price * (FEE_RATE + SLIPPAGE)
    target_sell = price * (1 - TARGET_MOVE) + price * (FEE_RATE + SLIPPAGE)
    stop_loss_buy = price - atr
    stop_loss_sell = price + atr
    
    if not np.isnan(last_row_1d['support']) and abs(target_buy - last_row_1d['support']) / price < 0.005:
        target_buy = last_row_1d['support'] * 0.98
    if not np.isnan(last_row_1d['resistance']) and abs(target_sell - last_row_1d['resistance']) / price < 0.005:
        target_sell = last_row_1d['resistance'] * 1.02
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal'], 'momentum': df_4h.iloc[-1]['momentum']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal'], 'momentum': df_1d.iloc[-1]['momentum']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    signal_data = {
        'pair': pair,
        'price': round(price, 2),
        'target': None,
        'stop_loss': None,
        'rsi': round(last_row_1h['rsi'], 2) if not np.isnan(last_row_1h['rsi']) else None,
        'atr': round(atr, 2) if not np.isnan(atr) else None,
        'support': round(last_row_1d['support'], 2) if not np.isnan(last_row_1d['support']) else None,
        'resistance': round(last_row_1d['resistance'], 2) if not np.isnan(last_row_1d['resistance']) else None,
        'momentum': round(last_row_1h['momentum'], 2) if not np.isnan(last_row_1h['momentum']) else None,
        'stoch_k': round(last_row_1h['stoch_k'], 2) if not np.isnan(last_row_1h['stoch_k']) else None,
        'confidence': 'Faible',
        'reason': None,
        'score': 0,
        'ml_prediction': round(ml_pred, 2) if ml_pred else None,
        'sentiment': round(sentiment, 2),
        'news_impact': round(news_impact, 2),
        'price_history': df_1h[['timestamp', 'close']].tail(50).to_dict(orient='records')
    }
    
    if buy_forced:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'ACHAT',
            'target': round(target_buy, 2),
            'stop_loss': round(stop_loss_buy, 2),
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI < 45, EMA neutre, MACD positif, Momentum positif, Fibonacci proche, support 1d proche, volatilité suffisante, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
        return signal_data
    elif sell_forced:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes, ml_pred, sentiment, news_impact) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None, ml_pred, sentiment, news_impact) * 0.2 if len(df_1d) > 0 else 0)
        signal_data.update({
            'signal': 'VENTE',
            'target': round(target_sell, 2),
            'stop_loss': round(stop_loss_sell, 2),
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI > 55, EMA neutre, MACD négatif, Momentum négatif, Fibonacci proche, résistance 1d proche, volatilité suffisante, avec ML, sentiment et news)',
            'score': round(score, 1)
        })
        return signal_data
    
    return None

# Backtest simple (data-driven validation)
def backtest_strategy(pair, capital=10000):
    ohlcv = fetch_ohlcv(pair, '1d', 365)
    if not ohlcv:
        return {'final_capital': capital, 'win_rate': 0, 'num_trades': 0, 'sharpe_ratio': 0}
    
    df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df = calculate_indicators(df)
    if df is None:
        return {'final_capital': capital, 'win_rate': 0, 'num_trades': 0, 'sharpe_ratio': 0}
    
    trades = []
    position = 0
    entry_price = 0
    
    for i in range(max(RSI_PERIOD, EMA_SLOW, STOCH_PERIOD), len(df)):
        last_row = df.iloc[i]
        buy_condition = last_row['rsi'] < 35 and last_row['macd'] > last_row['macd_signal'] and last_row['stoch_k'] < 30 and last_row['volume'] > last_row['volume_ema']
        sell_condition = last_row['rsi'] > 65 and last_row['macd'] < last_row['macd_signal'] and last_row['stoch_k'] > 70 and last_row['volume'] > last_row['volume_ema']
        
        if buy_condition and position == 0:
            position = capital / last_row['close']
            entry_price = last_row['close']
        elif sell_condition and position > 0:
            exit_price = last_row['close']
            profit = position * (exit_price - entry_price) - capital * FEE_RATE * 2
            trades.append(profit)
            capital += profit
            position = 0
    
    num_trades = len(trades)
    if num_trades == 0:
        return {'final_capital': capital, 'win_rate': 0, 'num_trades': 0, 'sharpe_ratio': 0}
    
    win_rate = sum(1 for t in trades if t > 0) / num_trades
    returns = pd.Series(trades)
    sharpe_ratio = returns.mean() / returns.std() * np.sqrt(252) if returns.std() != 0 else 0
    
    return {'final_capital': round(capital, 2), 'win_rate': round(win_rate, 2), 'num_trades': num_trades, 'sharpe_ratio': round(sharpe_ratio, 2)}

# Optimisation basique (grid search for params)
def optimize_params(pair):
    # Exemple simple sur BB_STD and RSI_PERIOD
    best_sharpe = -np.inf
    best_params = {'BB_STD': BB_STD, 'RSI_PERIOD': RSI_PERIOD}
    
    for bb_std in [1.5, 2.0, 2.5]:
        for rsi_period in [10, 14, 20]:
            # Temporarily set
            global BB_STD, RSI_PERIOD
            BB_STD = bb_std
            RSI_PERIOD = rsi_period
            backtest = backtest_strategy(pair)
            if backtest['sharpe_ratio'] > best_sharpe:
                best_sharpe = backtest['sharpe_ratio']
                best_params = {'BB_STD': bb_std, 'RSI_PERIOD': rsi_period}
    
    return best_params

# Plot chart for visualization
def plot_signals(df, pair):
    fig, ax = plt.subplots(figsize=(12, 6))
    ax.plot(df['timestamp'], df['close'], label='Close')
    ax.plot(df['timestamp'], df['ema_fast'], label='EMA Fast')
    ax.plot(df['timestamp'], df['ema_slow'], label='EMA Slow')
    ax.plot(df['timestamp'], df['upper_bb'], label='Upper BB', linestyle='--')
    ax.plot(df['timestamp'], df['lower_bb'], label='Lower BB', linestyle='--')
    ax.set_title(f'{pair} Price Chart with Indicators')
    ax.legend()
    plt.savefig(f'{pair.replace("/", "_")}_chart.png')
    plt.close()

# Function for multiprocessing
def process_pair(pair):
    try:
        dfs = {}
        for tf in TIMEFRAMES:
            ohlcv = fetch_ohlcv(pair, tf, LIMIT)
            if not ohlcv:
                return None
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df = calculate_indicators(df)
            if df is None:
                return None
            dfs[tf] = df
            time.sleep(0.2)
        signals, fallback = generate_signals(dfs['1h'], dfs['4h'], dfs['1d'], pair)
        backtest = backtest_strategy(pair)
        plot_signals(dfs['1h'], pair)  # Generate chart
        return signals, fallback, backtest, dfs['1h'], dfs['4h'], dfs['1d']
    except Exception as e:
        logger.error(f"Erreur pour {pair}: {e}")
        return None

# Main
def main():
    # Optimise params on BTC/USD for example
    optimized_params = optimize_params('BTC/USD')
    global BB_STD, RSI_PERIOD
    BB_STD = optimized_params['BB_STD']
    RSI_PERIOD = optimized_params['RSI_PERIOD']
    
    args = sys.argv[1:]
    if len(args) == 3:
        pair, entry_price, signal_type = args
        try:
            entry_price = float(entry_price)
            signal_type = signal_type.upper()
            if signal_type not in ['ACHAT', 'VENTE']:
                print(json.dumps({'type': 'error', 'message': 'Type de signal invalide (doit être ACHAT ou VENTE)'}))
                return
            if pair not in pairs:
                print(json.dumps({'type': 'error', 'message': f'Paire {pair} non supportée'}))
                return
            ohlcv_1h = fetch_ohlcv(pair, '1h', LIMIT)
            ohlcv_4h = fetch_ohlcv(pair, '4h', LIMIT)
            ohlcv_1d = fetch_ohlcv(pair, '1d', LIMIT)
            df_1h = pd.DataFrame(ohlcv_1h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_4h = pd.DataFrame(ohlcv_4h, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1d = pd.DataFrame(ohlcv_1d, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df_1h = calculate_indicators(df_1h)
            df_4h = calculate_indicators(df_4h)
            df_1d = calculate_indicators(df_1d)
            if df_1h is None or df_4h is None or df_1d is None:
                print(json.dumps({'type': 'error', 'message': 'Données insuffisantes pour l’analyse'}))
                return
            result = analyze_trade(pair, entry_price, signal_type, df_1h, df_4h, df_1d)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({'type': 'error', 'message': f'Erreur lors de l’analyse du trade: {str(e)}'}))
        return
    
    # Valider paires
    valid_pairs = []
    for p in pairs:
        for ex in exchanges.values():
            try:
                markets = ex.load_markets()
                if p in markets:
                    valid_pairs.append(p)
                    break
            except:
                pass
    if not valid_pairs:
        print(json.dumps({'type': 'error', 'message': 'Aucune paire valide disponible'}))
        return
    
    # Multiprocessing for pairs
    with Pool(processes=os.cpu_count()) as pool:
        results = pool.map(process_pair, valid_pairs)
    
    all_signals = []
    fallback_data = []
    backtest_results = []
    
    for res in results:
        if res:
            signals, fallback, backtest, df1h, df4h, df1d = res
            all_signals.extend(signals)
            fallback_data.append((fallback, df1h, df4h, df1d))
            backtest_results.append(backtest)
    
    # Correlation for diversification
    closes = {}
    for pair in valid_pairs:
        ohlcv = fetch_ohlcv(pair, '1d', 100)
        if ohlcv:
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            closes[pair] = df['close']
    
    if closes:
        corr_matrix = pd.DataFrame(closes).corr()
        for sig in all_signals:
            correlated = [p for p in valid_pairs if p != sig['pair'] and corr_matrix.loc[sig['pair'], p] > CORR_THRESHOLD]
            if correlated:
                sig['score'] *= 0.8  # Penalize high corr
    
    if all_signals:
        best_signal = max(all_signals, key=lambda x: x['score'])
    else:
        best_signal = force_trade(fallback_data)
    
    if best_signal:
        # Position sizing (Kelly criterion approximation)
        capital = 10000  # Example capital
        win_prob = best_signal['score'] / 100
        risk = abs(best_signal['price'] - best_signal['stop_loss']) / best_signal['price']
        rr = TARGET_MOVE / risk if risk > 0 else 1
        kelly = win_prob - (1 - win_prob) / rr
        position_size = capital * RISK_PER_TRADE * max(kelly, 0.1)  # Min 0.1 to avoid zero
        best_signal['position_size'] = round(position_size, 2)
        
        print(json.dumps({
            'type': 'best_signal',
            'result': best_signal
        }))
    else:
        if fallback_data:
            best_fallback = max(fallback_data, key=lambda x: x[0]['score'])
            score = best_fallback[0]['score']
            if score > 30:
                signal_type = 'ACHAT' if best_fallback[0]['rsi'] < 50 else 'VENTE'
                target = best_fallback[0]['price'] * (1 + TARGET_MOVE) if signal_type == 'ACHAT' else best_fallback[0]['price'] * (1 - TARGET_MOVE)
                stop_loss = best_fallback[0]['price'] - best_fallback[0]['atr'] if signal_type == 'ACHAT' else best_fallback[0]['price'] + best_fallback[0]['atr']
                print(json.dumps({
                    'type': 'best_signal',
                    'result': {
                        'pair': best_fallback[0]['pair'],
                        'signal': signal_type,
                        'price': best_fallback[0]['price'],
                        'target': round(target, 2),
                        'stop_loss': round(stop_loss, 2),
                        'rsi': best_fallback[0]['rsi'],
                        'atr': best_fallback[0]['atr'],
                        'support': best_fallback[0]['support'],
                        'resistance': best_fallback[0]['resistance'],
                        'confidence': 'Très Faible',
                        'score': round(score, 1),
                        'reason': 'Fallback final: Score minimal atteint, basé sur RSI global',
                        'price_history': best_fallback[0].get('price_history', [])
                    }
                }))
                return
        print(json.dumps({'type': 'error', 'message': 'Aucun trade possible (vérifiez les données ou paires)'}))

if __name__ == "__main__":
    main()

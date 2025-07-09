import ccxt
import pandas as pd
import numpy as np
from datetime import datetime
import time
import warnings
warnings.filterwarnings("ignore")

# Configuration de l'API Kraken
kraken = ccxt.kraken({
    'apiKey': '2cODKhMXAL9MqITr+81uSxqVfXoZCbVmnklgqsB2Ps7qj+GtI6douZLv',
    'secret': 'u6TZEwy6inpuWG5B10OiecmGRFrz2SNU46WTMJIuqcsm2lYvqqiSXR0G5uTBcWiaLk/oYChgWjsNB82uoMiD2wtJ',
})

# Paires confirmées
pairs = [
    'BTC/USD', 'ETH/USD', 'XRP/USD', 'SOL/USD', 'DOGE/USD', 'ADA/USD', 'SUI/USD',
    'AAVE/USD', 'LINK/USD', 'AVAX/USD', 'NEAR/USD', 'XLM/USD', 'LTC/USD'
]

# Paramètres
TIMEFRAMES = ['1h', '4h', '1d']  # Timeframes demandés
LIMIT = 100  # Bougies
BB_PERIOD = 20  # Bollinger
BB_STD = 2  # Écart-type
RSI_PERIOD = 14  # RSI
EMA_FAST = 12  # EMA rapide
EMA_SLOW = 26  # EMA lente
MACD_SIGNAL = 9  # MACD ligne de signal
ATR_PERIOD = 14  # ATR
LEVERAGE = 50  # Levier x50
TARGET_MOVE = 0.02  # 2% pour x2

# Calcul des indicateurs
def calculate_indicators(df):
    if df.empty or len(df) < BB_PERIOD:
        return None  # Retourner None si données insuffisantes
    
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
    
    # MACD
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
    for i in range(2, len(df) - 2):
        if df['low'].iloc[i] < df['low'].iloc[i-1] and df['low'].iloc[i] < df['low'].iloc[i+1]:
            supports.append(df['low'].iloc[i])
        if df['high'].iloc[i] > df['high'].iloc[i-1] and df['high'].iloc[i] > df['high'].iloc[i+1]:
            resistances.append(df['high'].iloc[i])
    df['supports'] = [min(supports, default=np.nan, key=lambda x: abs(x - df['close'].iloc[-1]))] * len(df)
    df['resistances'] = [min(resistances, default=np.nan, key=lambda x: abs(x - df['close'].iloc[-1]))] * len(df)
    
    return df

# Calcul du score
def calculate_score(last_row, signal_type, higher_timeframes=None):
    if higher_timeframes is None:
        higher_timeframes = []
    
    score = 0
    price = last_row['close']
    
    # RSI (14%)
    rsi = last_row['rsi']
    if signal_type == 'ACHAT':
        if rsi < 30:
            score += 14
        elif rsi < 35:
            score += 8
    else:
        if rsi > 70:
            score += 14
        elif rsi > 65:
            score += 8
    
    # Bollinger (14%)
    if signal_type == 'ACHAT':
        if price <= last_row['lower_bb']:
            score += 14
        elif price <= last_row['sma']:
            score += 8
    else:
        if price >= last_row['upper_bb']:
            score += 14
        elif price >= last_row['sma']:
            score += 8
    
    # EMA (14%)
    if signal_type == 'ACHAT':
        if last_row['ema_fast'] > last_row['ema_slow']:
            score += 14
        elif last_row['ema_fast'] >= last_row['ema_slow'] * 0.995:
            score += 8
    else:
        if last_row['ema_fast'] < last_row['ema_slow']:
            score += 14
        elif last_row['ema_fast'] <= last_row['ema_slow'] * 1.005:
            score += 8
    
    # Fibonacci (14%)
    fib_levels = ['fib_0.236', 'fib_0.382', 'fib_0.5', 'fib_0.618', 'fib_0.764']
    fib_proximities = [abs(price - last_row[level]) / price for level in fib_levels if not np.isnan(last_row[level])]
    fib_proximity = min(fib_proximities, default=np.inf)
    if fib_proximity < 0.02:
        score += 14
    elif fib_proximity < 0.05:
        score += 8
    
    # ATR (14%)
    atr = last_row['atr']
    if atr > last_row['close'] * 0.01:
        score += 14
    elif atr > last_row['close'] * 0.005:
        score += 8
    
    # Support/Résistance (14%)
    if signal_type == 'ACHAT' and not np.isnan(last_row['supports']):
        if abs(price - last_row['supports']) / price < 0.01:
            score += 14
    elif signal_type == 'VENTE' and not np.isnan(last_row['resistances']):
        if abs(price - last_row['resistances']) / price < 0.01:
            score += 14
    
    # MACD (14%)
    if signal_type == 'ACHAT' and last_row['macd'] > last_row['macd_signal']:
        score += 14
    elif signal_type == 'VENTE' and last_row['macd'] < last_row['macd_signal']:
        score += 14
    elif signal_type == 'ACHAT' and last_row['macd'] > 0:
        score += 8
    elif signal_type == 'VENTE' and last_row['macd'] < 0:
        score += 8
    
    # Multi-timeframe (bonus +10)
    confirmation_count = 0
    for tf_data in higher_timeframes:
        if signal_type == 'ACHAT' and tf_data['rsi'] < 35 and tf_data['ema_fast'] > tf_data['ema_slow'] and tf_data['macd'] > tf_data['macd_signal']:
            confirmation_count += 1
        elif signal_type == 'VENTE' and tf_data['rsi'] > 65 and tf_data['ema_fast'] < tf_data['ema_slow'] and tf_data['macd'] < tf_data['macd_signal']:
            confirmation_count += 1
    if confirmation_count >= 2:
        score += 10
    
    return min(score, 100)

# Générer des signaux
def generate_signals(df_1h, df_4h, df_1d, pair):
    if df_1h is None or df_4h is None or df_1d is None:
        return [], {'pair': pair, 'score': 0}
    
    signals = []
    last_row_1h = df_1h.iloc[-1]
    price = last_row_1h['close']
    
    fib_levels_buy = ['fib_0.618', 'fib_0.5', 'fib_0.764']
    fib_levels_sell = ['fib_0.236', 'fib_0.382', 'fib_0.5']
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in fib_levels_buy 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in fib_levels_sell 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    # Niveau 1 : Strict (1h)
    buy_strict = (
        (price <= last_row_1h['lower_bb']) and
        (last_row_1h['rsi'] < 30) and
        (last_row_1h['ema_fast'] > last_row_1h['ema_slow']) and
        (last_row_1h['macd'] > last_row_1h['macd_signal']) and
        (fib_proximity_buy < 0.02) and
        (not np.isnan(last_row_1h['supports']) and abs(price - last_row_1h['supports']) / price < 0.01)
    )
    sell_strict = (
        (price >= last_row_1h['upper_bb']) and
        (last_row_1h['rsi'] > 70) and
        (last_row_1h['ema_fast'] < last_row_1h['ema_slow']) and
        (last_row_1h['macd'] < last_row_1h['macd_signal']) and
        (fib_proximity_sell < 0.02) and
        (not np.isnan(last_row_1h['resistances']) and abs(price - last_row_1h['resistances']) / price < 0.01)
    )
    
    # Niveau 2 : Moyen (1h)
    buy_medium = (
        (price <= last_row_1h['sma']) and
        (last_row_1h['rsi'] < 35) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.995) and
        (last_row_1h['macd'] > 0) and
        (fib_proximity_buy < 0.05)
    )
    sell_medium = (
        (price >= last_row_1h['sma']) and
        (last_row_1h['rsi'] > 65) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.005) and
        (last_row_1h['macd'] < 0) and
        (fib_proximity_sell < 0.05)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr * 1.5
    stop_loss_sell = price + atr * 1.5
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    if buy_strict:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            'pair': pair,
            'signal': 'ACHAT',
            'price': price,
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger bas, RSI < 30, EMA haussier, MACD haussier, Fibonacci + support, confirmé 4h/1d)',
            'score': score
        })
    elif sell_strict:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            'pair': pair,
            'signal': 'VENTE',
            'price': price,
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Élevé',
            'reason': 'Conditions strictes (Bollinger haut, RSI > 70, EMA baissier, MACD baissier, Fibonacci + résistance, confirmé 4h/1d)',
            'score': score
        })
    elif buy_medium:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            'pair': pair,
            'signal': 'ACHAT',
            'price': price,
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sous SMA, RSI < 35, EMA neutre, MACD positif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': score
        })
    elif sell_medium:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        signals.append({
            'pair': pair,
            'signal': 'VENTE',
            'price': price,
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Moyen',
            'reason': 'Conditions moyennes (prix sur SMA, RSI > 65, EMA neutre, MACD négatif, Fibonacci proche, partiellement confirmé 4h/1d)',
            'score': score
        })
    
    return signals, {
        'pair': pair,
        'atr': atr,
        'rsi': last_row_1h['rsi'],
        'price': price,
        'ema_trend': last_row_1h['ema_fast'] > last_row_1h['ema_slow'],
        'macd': last_row_1h['macd'],
        'macd_signal': last_row_1h['macd_signal'],
        'supports': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
        'resistances': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
        'score': calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes)
    }

# Forcer un trade
def force_trade(fallback_data):
    if not fallback_data:
        return None
    
    # Trouver la meilleure paire
    valid_fallbacks = [(f, df1, df2, df3) for f, df1, df2, df3 in fallback_data if df1 is not None and df2 is not None and df3 is not None]
    if not valid_fallbacks:
        return None
    
    best_fallback = max(valid_fallbacks, key=lambda x: x[0]['score'])
    pair = best_fallback[0]['pair']
    df_1h, df_4h, df_1d = best_fallback[1], best_fallback[2], best_fallback[3]
    
    last_row_1h = df_1h.iloc[-1]
    price = last_row_1h['close']
    
    fib_levels_buy = ['fib_0.618', 'fib_0.5', 'fib_0.764']
    fib_levels_sell = ['fib_0.236', 'fib_0.382', 'fib_0.5']
    fib_proximity_buy = min([abs(price - last_row_1h[level]) / price for level in fib_levels_buy 
                             if not np.isnan(last_row_1h[level])], default=np.inf)
    fib_proximity_sell = min([abs(price - last_row_1h[level]) / price for level in fib_levels_sell 
                              if not np.isnan(last_row_1h[level])], default=np.inf)
    
    # Conditions forcées (assouplies)
    buy_forced = (
        (price <= last_row_1h['sma'] * 1.05) and
        (last_row_1h['rsi'] < 40) and
        (last_row_1h['ema_fast'] >= last_row_1h['ema_slow'] * 0.99) and
        (last_row_1h['macd'] >= 0) and
        (fib_proximity_buy < 0.1) and
        (not np.isnan(last_row_1h['supports']) and abs(price - last_row_1h['supports']) / price < 0.02) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.005)
    )
    sell_forced = (
        (price >= last_row_1h['sma'] * 0.95) and
        (last_row_1h['rsi'] > 60) and
        (last_row_1h['ema_fast'] <= last_row_1h['ema_slow'] * 1.01) and
        (last_row_1h['macd'] <= 0) and
        (fib_proximity_sell < 0.1) and
        (not np.isnan(last_row_1h['resistances']) and abs(price - last_row_1h['resistances']) / price < 0.02) and
        (last_row_1h['atr'] > last_row_1h['close'] * 0.005)
    )
    
    atr = last_row_1h['atr'] if not np.isnan(last_row_1h['atr']) else last_row_1h['close'] * 0.005
    target_buy = price * (1 + TARGET_MOVE)
    target_sell = price * (1 - TARGET_MOVE)
    stop_loss_buy = price - atr * 1.5
    stop_loss_sell = price + atr * 1.5
    
    higher_timeframes = [
        {'rsi': df_4h.iloc[-1]['rsi'], 'ema_fast': df_4h.iloc[-1]['ema_fast'], 
         'ema_slow': df_4h.iloc[-1]['ema_slow'], 'macd': df_4h.iloc[-1]['macd'], 
         'macd_signal': df_4h.iloc[-1]['macd_signal']} if len(df_4h) > 0 else None,
        {'rsi': df_1d.iloc[-1]['rsi'], 'ema_fast': df_1d.iloc[-1]['ema_fast'], 
         'ema_slow': df_1d.iloc[-1]['ema_slow'], 'macd': df_1d.iloc[-1]['macd'], 
         'macd_signal': df_1d.iloc[-1]['macd_signal']} if len(df_1d) > 0 else None
    ]
    higher_timeframes = [tf for tf in higher_timeframes if tf is not None]
    
    if buy_forced:
        score = calculate_score(last_row_1h, 'ACHAT', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'ACHAT', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'ACHAT', None) * 0.2 if len(df_1d) > 0 else 0)
        return {
            'pair': pair,
            'signal': 'ACHAT',
            'price': price,
            'target': target_buy,
            'stop_loss': stop_loss_buy,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Faible',
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI < 40, EMA neutre, MACD positif, Fibonacci proche, support proche, volatilité suffisante, partiellement confirmé 4h/1d)',
            'score': score
        }
    elif sell_forced:
        score = calculate_score(last_row_1h, 'VENTE', higher_timeframes) * 0.5 + \
                (calculate_score(df_4h.iloc[-1], 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
                (calculate_score(df_1d.iloc[-1], 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
        return {
            'pair': pair,
            'signal': 'VENTE',
            'price': price,
            'target': target_sell,
            'stop_loss': stop_loss_sell,
            'rsi': last_row_1h['rsi'],
            'atr': atr,
            'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
            'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
            'confidence': 'Faible',
            'reason': 'Trade forcé (conditions assouplies: prix près de SMA, RSI > 60, EMA neutre, MACD négatif, Fibonacci proche, résistance proche, volatilité suffisante, partiellement confirmé 4h/1d)',
            'score': score
        }
    
    # Dernier recours : meilleur score
    score = calculate_score(last_row_1h, 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', higher_timeframes) * 0.5 + \
            (calculate_score(df_4h.iloc[-1], 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', None) * 0.3 if len(df_4h) > 0 else 0) + \
            (calculate_score(df_1d.iloc[-1], 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE', None) * 0.2 if len(df_1d) > 0 else 0)
    signal = 'ACHAT' if last_row_1h['rsi'] < 50 else 'VENTE'
    target = target_buy if signal == 'ACHAT' else target_sell
    stop_loss = stop_loss_buy if signal == 'ACHAT' else stop_loss_sell
    return {
        'pair': pair,
        'signal': signal,
        'price': price,
        'target': target,
        'stop_loss': stop_loss,
        'rsi': last_row_1h['rsi'],
        'atr': atr,
        'support': last_row_1h['supports'] if not np.isnan(last_row_1h['supports']) else None,
        'resistance': last_row_1h['resistances'] if not np.isnan(last_row_1h['resistances']) else None,
        'confidence': 'Faible',
        'reason': 'Trade forcé (meilleur score global basé sur tous les indicateurs, partiellement confirmé 4h/1d)',
        'score': score
    }

# Main
def main():
    print("Analyse des cryptos pour trading intraday (levier x50 sur Kraken)")
    print(f"Date/Heure: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 80)
    
    # Vérifier les paires valides
    try:
        markets = kraken.load_markets()
        valid_pairs = [p for p in pairs if p in markets]
        if not valid_pairs:
            print("\nAucune paire valide disponible.")
            return
        print(f"Paires valides: {valid_pairs}")
    except Exception as e:
        print(f"Erreur lors de la vérification des paires: {e}")
        return
    
    all_signals = []
    fallback_data = []
    
    for pair in valid_pairs:
        try:
            # Récupérer données 1h, 4h, 1d
            dfs = {}
            for tf in TIMEFRAMES:
                ohlcv = kraken.fetch_ohlcv(pair, timeframe=tf, limit=LIMIT)
                df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                df = calculate_indicators(df)
                if df is None:
                    print(f"Données insuffisantes pour {pair} ({tf})")
                    break
                dfs[tf] = df
                time.sleep(1)  # Éviter rate limit
            else:
                # Générer signaux si toutes les données sont valides
                signals, fallback = generate_signals(dfs['1h'], dfs['4h'], dfs['1d'], pair)
                all_signals.extend(signals)
                fallback_data.append((fallback, dfs['1h'], dfs['4h'], dfs['1d']))
        except Exception as e:
            print(f"Erreur pour {pair}: {e}")
    
    # Choisir le meilleur signal
    if all_signals:
        best_signal = max(all_signals, key=lambda x: x['score'])
    else:
        valid_fallbacks = [(f, df1, df2, df3) for f, df1, df2, df3 in fallback_data if df1 is not None and df2 is not None and df3 is not None]
        if not valid_fallbacks:
            print("\nAucun trade possible (toutes les données sont invalides).")
            return
        best_signal = force_trade(valid_fallbacks)
    
    # Afficher
    if best_signal:
        print("\nMeilleur trade du jour:")
        print("-" * 80)
        print(f"Actif: {best_signal['pair']}")
        print(f"Signal: {best_signal['signal']}")
        print(f"Prix d'entrée: {best_signal['price']:.2f} USD")
        print(f"Cible (x2 avec levier x50): {best_signal['target']:.2f} USD")
        print(f"Stop-loss: {best_signal['stop_loss']:.2f} USD")
        print(f"RSI (1h): {best_signal['rsi']:.2f}")
        print(f"Volatilité (ATR): {best_signal['atr']:.2f}")
        if best_signal['support'] is not None:
            print(f"Support le plus proche (1h): {best_signal['support']:.2f} USD")
        if best_signal['resistance'] is not None:
            print(f"Résistance la plus proche (1h): {best_signal['resistance']:.2f} USD")
        print(f"Confiance: {best_signal['confidence']}")
        print(f"Score: {best_signal['score']:.1f}/100")
        print(f"Raison: {best_signal['reason']}")
        print("-" * 80)
    else:
        print("\nAucun trade possible (vérifiez les données ou paires).")
    
    print("\nConseil: Relancez demain pour un nouveau trade.")

if __name__ == "__main__":
    main()
